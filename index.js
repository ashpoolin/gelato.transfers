const WebSocket = require('ws');
// import WebSocket from 'ws';

// const { json } = require('express');
const bs58 = require('bs58');
const BN = require('bn.js');
const Buffer = require('buffer').Buffer;
const { Connection, LAMPORTS_PER_SOL, PublicKey} = require('@solana/web3.js');
const { publicKey, u64 } = require('@solana/buffer-layout-utils');
const { blob,  u8, u32, nu64, ns64, struct, seq } = require('@solana/buffer-layout'); // Layout
const sha256 = require('crypto-js/sha256');

require('dotenv').config();
// Create a WebSocket connection
console.log(`process.env.HELIUS_WEBSOCKETS_URL: ${process.env.HELIUS_WEBSOCKETS_URL}`);
const ws = new WebSocket(process.env.HELIUS_WEBSOCKETS_URL);

const Pool = require('pg').Pool
const pool = new Pool({
    user: process.env.PGUSERNAME,
    host: process.env.PGHOSTNAME,
    database: process.env.PGDATABASE,
    password: process.env.PGPASSWORD,
    port: process.env.PGPORT,
    ssl: { rejectUnauthorized: false }
  });

// system program interfaces
const TransferLayout = struct([
  u32 ('discriminator'),
  u64('lamports'),
]);

const CreateAccountLayout = struct([
  u32 ('discriminator'),
  u64('lamports'),
  u64('space'),
  u32('owner'),
]);

const CreateAccountWithSeedLayout = struct([
  u32('discriminator'),
  publicKey('base'),
  u8('seedLength'),
  blob(24, 'seed'), 
  // seq(u8(), 24, 'seed'), 
  u64('lamports'), 
  u64('space'), 
  publicKey('owner'), 
]);

// stake program interfaces
const AuthorizedLayout = struct([
  publicKey('staker'),
  publicKey('withdrawer')
])
const LockupLayout = struct([
  ns64('unix_timestamp'),
  nu64('epoch'),
  publicKey('custodian')
]);
const StakeInitializeLayout = struct([
  u32('discriminator'), 
  AuthorizedLayout.replicate('authorized'),
  LockupLayout.replicate('lockup'),
]);

const WithdrawLayout = struct([
  u32 ('discriminator'),
  u64('lamports'),
]);

const SplitLayout = struct([
  u32 ('discriminator'),
  u64('lamports'),
]);

const AuthorizeLayout = struct([
  u32('discriminator'),
  publicKey('withdrawer'), //sometimes it's the custodian though! How to tell the difference?
  u32('authorityType'),
]);

const AuthorizeCheckedLayout = struct([
  u8('discriminator'),
  u8('authorizeWithCustodian'),
]);

const ChangeCommissionLayout = struct([
  u32 ('discriminator'),
  u8('commission'),
]);


// spl-token interfaces
const TokenTransferLayout = struct([
  u8('discriminator'),
  u64('amount'),
]);

const TokenTransferCheckedLayout = struct([
  u8('discriminator'),
  u64('amount'),
  u8('decimals'),
]);

let programMap = new Map([
  ["11111111111111111111111111111111", "system"],
  ["Stake11111111111111111111111111111111111111", "stake"],
  ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "spl-token"],
  ["Vote111111111111111111111111111111111111111", "vote"]
]);

// lookup by position in the enum here:
// - system = https://docs.rs/solana-program/latest/src/solana_program/system_instruction.rs.html#201
// - stake =
let MethodMap = new Map([
  ["system_0", "createAccount"],
  ["system_1", "assign"],
  ["system_2", "transfer"],
  ["system_3", "createAccountWithSeed"],
  ["system_4", "advanceNonceAccount"],
  ["stake_0", "initialize"], // confirmed
  ["stake_1", "authorize"], // confirmed
  ["stake_2", "delegate"], // confirmed
  ["stake_3", "split"], // confirmed
  ["stake_4", "withdraw"], // confirmed
  ["stake_5", "deactivate"], // confirmed
  ["stake_7", "merge"], // confirmed
  ["spl-token_3", "transfer"],
  ["spl-token_12", "transferChecked"],
  ["vote_3", "withdraw"],
  ["vote_5", "changeCommission"],
]);

const insertData = async (signature, fields, values) => {
  return new Promise(function(resolve, reject) {
      const QUERY_TEXT = `INSERT INTO websockets_sol_event_log(${fields}) VALUES(${values}) ON CONFLICT DO NOTHING;`
      // console.log(QUERY_TEXT)
      pool.query(QUERY_TEXT, (error, results) => {
        if (error) {
          reject(error)
          console.log("insert FAILED!");
        }
        resolve(results.rows);
        console.log(`inserted sig OK: ${signature}`);
      })
  });
}

const hashMessage = (message) => {
  const hash = sha256(message).toString();
  const encodedHash = bs58.encode(Buffer.from(hash, 'hex'));
  return encodedHash;
}

function getCurrentTime() {
  const currentUnixEpoch = Math.floor(Date.now() / 1000);
  // const currentUTC = new Date().toISOString().replace(/T/, ' ').replace(/\..+/, '');
  // return { unixEpoch: currentUnixEpoch, utcTimestamp: currentUTC };
  return currentUnixEpoch;
}

const insertParsedTransaction = async (messageObj) => {
  
    try {
        // const data = req.body[0];
        // const signature = process.argv[2]
        // const data = await SOLANA_CONNECTION.getTransaction(signature);
  
        const data = messageObj.params.result.transaction;
        const signature = messageObj.params.result.signature;
        // console.log(`signature: ${signature}`);
//        console.log(JSON.parse(JSON.stringify(data)));
        const slot = data?.slot;
        // const blocktime = data?.blockTime;
        const approximateBlocktime = getCurrentTime();
        const err = data?.meta.err;
        const fee = data?.meta.fee / LAMPORTS_PER_SOL;
        // const signature = data?.transaction.signatures[0];
//        console.log(data?.transaction.message.accountKeys.map(keye => keye.toBase58()))
  
        // testing, get info
        //data?.transaction.message.instructions.map(async (instruction, index) => {
          //  const programAddress = data?.transaction.message.accountKeys[instruction.programIdIndex].toString()
          //  const program = programMap.get(programAddress);
          //  console.log(`program: ${program}`)
          //  console.log(instruction)
          //  const ix = bs58.decode(instruction.data)
          //  console.log(`ix: ${ix}`)
          //  const prefix = ix.slice(0,4);
          //  console.log(`prefix: ${prefix}`)
          //  const disc = (program === 'spl-token') ? prefix[0] : (Buffer.from(prefix)).readUInt32LE();
          //  console.log(`disc: ${disc}`)
          //  const instructionType = MethodMap.get(`${program}_${disc}`)
          //  console.log(`instructionType: ${instructionType}`)
//        });
  
        data?.transaction.message.instructions.map(async (instruction, index) => {
          const programAddress = data?.transaction.message.accountKeys[instruction.programIdIndex].toString()
          const program = programMap.get(programAddress);
          const ix = bs58.decode(instruction.data);
          let disc;
          let prefix;
          try {
            if (program === 'spl-token') {
              disc = ix.slice(0,1);
              // disc = prefix; 
            } else {
              disc = (Buffer.from(ix.slice(0,4))).readUInt32LE()
            }
          } catch (err) {
            disc = 999;
          }

            // //NEW ONE, THIS WORKS
            // const prefix = ix.slice(0,4); // out of bounds b/c sometimes the data may not be 4 bytes long, right? 
            // let disc;
            // try {
            //   disc = (program === 'spl-token') ? prefix[0] : (Buffer.from(prefix)).readUInt32LE();
            // } catch (err) {
            //   disc = 999;
            // }

            // const disc = try {
            //   (program === 'spl-token') ? prefix[0] : (Buffer.from(prefix)).readUInt32LE(); //RangeError [ERR_BUFFER_OUT_OF_BOUNDS]: Attempt to access memory outside buffer bounds
            // } catch (err) {
            //   disc = 99;
            // }
            // const disc = prefix[0]
            // console.log("OK")
            // console.log(disc)
  
            // console.log(program)
            const instructionType = MethodMap.get(`${program}_${disc}`)
            // console.log(instructionType)
            // instruction.accounts.map(account => {
            //   console.log(account)
            // })
  
            // console.log(`accountKeys: ${
            //     data?.transaction.message.accountKeys.map(key => {
            //         return key
            //     })
            // }`)
            // if (program == 'vote') {
            //   if (instructionType == 'withdraw') {
            //     const deserialized = WithdrawLayout.decode(ix);
            //     const lamports = Number(deserialized.lamports);
            //     const uiAmount = lamports / LAMPORTS_PER_SOL
            //     const from = data?.transaction.message.accountKeys[instruction.accounts[0]]
            //     const to = data?.transaction.message.accountKeys[instruction.accounts[1]]
            //     const withdrawAuthority = data?.transaction.message.accountKeys[instruction.accounts[2]]
            //     // const fields = ['program', 'type', 'signature', 'err', 'slot', 'blocktime', 'fee', 'authority2', 'source', 'destination', 'u>
            //     // const values = [`'${program}'`,`'${instructionType}'`,`'${signature}'`,`'${err}'`,slot,blocktime,fee,`'${(new PublicKey(with>
            //     console.log(`${program},${instructionType},${signature},${err},${slot},${blocktime},${fee},,${withdrawAuthority},,${(new PublicKey(from)).toBase58()},${(new PublicKey(to)).toString()},,,,${uiAmount}`);
            //   }
            //   else if (instructionType == 'changeCommission') {
            //     const deserialized = ChangeCommissionLayout.decode(ix);
            //     const commission = Number(deserialized.commission);
            //     const withdrawer = data?.transaction.message.accountKeys[instruction.accounts[1]]
            //     const votePubkey = data?.transaction.message.accountKeys[instruction.accounts[0]]
            //     console.log(`${program},${instructionType},${signature},${err},${slot},${blocktime},${fee},,${withdrawer},,${votePubkey},,,,,${commission}`);
            //   }
            // }
            // if (program == 'stake') {
            //     if (instructionType == 'initialize') {
            //         let deserialized;
            //         try {
            //           deserialized = StakeInitializeLayout.decode(ix);
            //         } catch (err) {
            //           console.log(err);
            //         }
            //         const staker = deserialized.authorized.staker
            //         const withdrawer = deserialized.authorized.withdrawer
            //         const custodian = deserialized.lockup.custodian
            //         const stakeAccount = data?.transaction.message.accountKeys[instruction.accounts[0]];
            //         const epoch = deserialized.lockup.epoch
            //         const unixTimestamp = deserialized.lockup.unix_timestamp
            //         const fields = ['program','type','signature','err','slot','blocktime','fee','authority','authority2','authority3','destination','misc1','misc2','serial'];
            //         const values = [`'${program}'`,`'${instructionType}'`,`'${signature}'`,`'${err}'`,slot,blocktime,fee,`'${(new PublicKey(staker)).toBase58()}'`,`'${(new PublicKey(withdrawer)).toBase58()}'`,`'${(new PublicKey(custodian)).toBase58()}'`,`'${(new PublicKey(stakeAccount)).toBase58()}'`,epoch,unixTimestamp,`'${encodedHash}'`];
            //         console.log(`${program},${instructionType},${signature},${err},${slot},${blocktime},${fee},${staker},${withdrawer},${custodian},,${stakeAccount},,${epoch},${unixTimestamp},`);
            //     } 
            //     else if (instructionType == 'delegate') {
            //         const stakeAccount = data?.transaction.message.accountKeys[instruction.accounts[0]];
            //         const stakeAuthority = data?.transaction.message.accountKeys[instruction.accounts[5]];
            //         const voteAccount = data?.transaction.message.accountKeys[instruction.accounts[1]];
            //         const fields = ['program','type','signature','err','slot','blocktime','fee','authority','destination','destination2'];
            //         const values = [`'${program}'`,`'${instructionType}'`,`'${signature}'`,`'${err}'`,slot,blocktime,fee,`'${(new PublicKey(stakeAuthority)).toBase58()}'`,`'${(new PublicKey(stakeAccount)).toBase58()}'`,`'${(new PublicKey(voteAccount)).toBase58()}'`];
            //         console.log(`${program},${instructionType},${signature},${err},${slot},${blocktime},${fee},${stakeAuthority},,,,${stakeAccount},${voteAccount},,,`);
            //     } 
            //     else if (instructionType == 'deactivate') {
            //         const stakeAuthority = data?.transaction.message.accountKeys[instruction.accounts[2]]
            //         const stakeAccount = data?.transaction.message.accountKeys[instruction.accounts[0]]
            //         const fields = ['program','type','signature','err','slot','blocktime','fee','authority','source']
            //         const values = [`'${program}'`,`'${instructionType}'`,`'${signature}'`,`'${err}'`,slot,blocktime,fee,`'${(new PublicKey(stakeAuthority)).toBase58()}'`,`'${(new PublicKey(stakeAccount)).toBase58()}'`];
            //         console.log(`${program},${instructionType},${signature},${err},${slot},${blocktime},${fee},${stakeAuthority},,,${stakeAccount},,,,,`);
            //     } 
            //     else if (instructionType == 'withdraw') {
            //         let deserialized;
            //         try {
            //           deserialized = WithdrawLayout.decode(ix);
            //         } catch (err) {
            //           console.log(err);
            //         }
            //         const lamports = Number(deserialized.lamports) || -1; // TypeError: Cannot read properties of undefined (reading 'lamports')
            //         const uiAmount = lamports / LAMPORTS_PER_SOL
            //         const from = data?.transaction.message.accountKeys[instruction.accounts[0]]
            //         const to = data?.transaction.message.accountKeys[instruction.accounts[1]]
            //         const withdrawAuthority = data?.transaction.message.accountKeys[instruction.accounts[4]]
            //         const fields = ['program', 'type', 'signature', 'err', 'slot', 'blocktime', 'fee', 'authority2', 'source', 'destination', 'uiAmount']
            //         const values = [`'${program}'`,`'${instructionType}'`,`'${signature}'`,`'${err}'`,slot,blocktime,fee,`'${(new PublicKey(withdrawAuthority)).toBase58()}'`,`'${(new PublicKey(from)).toBase58()}'`,`'${(new PublicKey(to)).toBase58()}'`,uiAmount];
            //         console.log(`${program},${instructionType},${signature},${err},${slot},${blocktime},${fee},,${withdrawAuthority},,${(new PublicKey(from)).toBase58()},${(new PublicKey(to)).toString()},,,,${uiAmount}`);
            //     }
            //     else if (instructionType == 'merge') {
            //       const from = data?.transaction.message.accountKeys[instruction.accounts[1]] // source
            //       const to = data?.transaction.message.accountKeys[instruction.accounts[0]] // destination
            //       const stakeAuthority = data?.transaction.message.accountKeys[instruction.accounts[4]] // stake authority
            //       const fields = ['program', 'type', 'signature', 'err', 'slot', 'blocktime', 'fee', 'authority', 'source', 'destination']
            //       const values = [`'${program}'`,`'${instructionType}'`,`'${signature}'`,`'${err}'`,slot,blocktime,fee,`'${(new PublicKey(stakeAuthority)).toBase58()}'`,`'${(new PublicKey(from)).toBase58()}'`,`'${(new PublicKey(to)).toBase58()}'`];
            //       console.log(`${program},${instructionType},${signature},${err},${slot},${blocktime},${fee},${stakeAuthority},,,${(new PublicKey(from)).toBase58()},${(new PublicKey(to)).toString()},,,,`);
            //   }
            //   else if (instructionType == 'split') {
            //     let deserialized;
            //     try {
            //       deserialized = SplitLayout.decode(ix);
            //     } catch (err) {
            //       console.log(err);
            //     }
            //     const lamports = Number(deserialized.lamports);
            //     const uiAmount = lamports / LAMPORTS_PER_SOL
            //     const from = data?.transaction.message.accountKeys[instruction.accounts[0]]
            //     const to = data?.transaction.message.accountKeys[instruction.accounts[1]]
            //     const stakeAuthority = data?.transaction.message.accountKeys[instruction.accounts[2]]
            //     const fields = ['program', 'type', 'signature', 'err', 'slot', 'blocktime', 'fee', 'authority', 'source', 'destination', 'uiAmount']
            //     const values = [`'${program}'`,`'${instructionType}'`,`'${signature}'`,`'${err}'`,slot,blocktime,fee,`'${(new PublicKey(stakeAuthority)).toBase58()}'`,`'${(new PublicKey(from)).toBase58()}'`,`'${(new PublicKey(to)).toBase58()}'`,uiAmount];
            //     console.log(`${program},${instructionType},${signature},${err},${slot},${blocktime},${fee},,${stakeAuthority},,${(new PublicKey(from)).toBase58()},${(new PublicKey(to)).toString()},,,,${uiAmount}`);
            //   }
            //   else if (instructionType === 'authorize') {
            //     let deserialized;
            //     try {
            //       deserialized = AuthorizeLayout.decode(ix);
            //     } catch (err) {
            //       console.log(err);
            //     }
            //     const authority2 = (new PublicKey(deserialized.withdrawer)).toBase58(); // new authority
            //     const authority3 = 'no custodian found' //(new PublicKey(deserialized.custodian)).toBase58();
            //     const source = data?.transaction.message.accountKeys[instruction.accounts[0]] // stakeAccount
            //     const authority = data?.transaction.message.accountKeys[instruction.accounts[2]] // old authority
            //     //const fields = ['program', 'type', 'signature', 'err', 'slot', 'blocktime', 'fee', 'authority', 'authority2', 'authority3', 'so>
            //     //const values = [`'${program}'`,`'${instructionType}'`,`'${signature}'`,`'${err}'`,slot,blocktime,fee,`'${(new PublicKey(authori>
            //     console.log(`${program},${instructionType},${signature},${err},${slot},${blocktime},${fee},${authority},${authority2},${authority3},${(new PublicKey(source)).toBase58()},,,,,`);
            //   }
            //   else if (instructionType === 'authorizeChecked') {
            //     // const deserialized = AuthorizeCheckedLayout.decode(ix);
            //     // const authorizeWithCustodian = deserialized.authorizeWithCustodian;
            //     const source = data?.transaction.message.accountKeys[instruction.accounts[0]] // stakeAccount
            //     const authority = data?.transaction.message.accountKeys[instruction.accounts[2]] // old authority
            //     const authority2 = data?.transaction.message.accountKeys[instruction.accounts[3]] // new authority
            //     const authority3 = data?.transaction.message.accountKeys[instruction.accounts[4]] // custodian
            //     //const fields = ['program', 'type', 'signature', 'err', 'slot', 'blocktime', 'fee', 'authority', 'authority2', 'authority3', 'so>
            //     //const values = [`'${program}'`,`'${instructionType}'`,`'${signature}'`,`'${err}'`,slot,blocktime,fee,`'${(new PublicKey(authori>
            //     console.log(`${program},${instructionType},${signature},${err},${slot},${blocktime},${fee},${authority},${authority2},${authority3},${(new PublicKey(source)).toBase58()},,,,,`);
            //   }
            // } 
            // else if (program == 'system'){
            if (program == 'system'){
                // if (instructionType == 'createAccount') {
                //     let deserialized;
                //     try {
                //       deserialized = CreateAccountLayout.decode(ix);
                //     } catch (err) {
                //       console.log(err);
                //     }
                //     const lamports = Number(deserialized.lamports);
                //     const uiAmount = lamports / LAMPORTS_PER_SOL
                //     const from = data?.transaction.message.accountKeys[instruction.accounts[0]]
                //     const to = data?.transaction.message.accountKeys[instruction.accounts[1]]
                //     const fields = ['program','type','signature','err','slot','blocktime','fee','source','destination','uiAmount'];
                //     const values = [`'${program}'`,`'${instructionType}'`,`'${signature}'`,`'${err}'`,slot,blocktime,fee,`'${(new PublicKey(from)).toBase58()}'`,`'${(new PublicKey(to)).toBase58()}'`,uiAmount];
                //     console.log(`${program},${instructionType},${signature},${err},${slot},${blocktime},${fee},,,,${from},${to},,,,${uiAmount}`);
                // }
                // else if (instructionType == 'createAccountWithSeed') {
                //     let deserialized;
                //     try {
                //       deserialized = CreateAccountWithSeedLayout.decode(ix);
                //     } catch (err) {
                //       console.log(err);
                //     }
                //     lamports = data?.meta.postBalances[instruction.accounts[1]] - data?.meta.preBalances[instruction.accounts[1]];
                //     const uiAmount = lamports / LAMPORTS_PER_SOL
                //     const space = Number(deserialized.space);
                //     const seed = 'seed unavailable';
                //     const from = data?.transaction.message.accountKeys[instruction.accounts[0]]
                //     const to = data?.transaction.message.accountKeys[instruction.accounts[1]]
                //     const fields = ['program','type','signature','err','slot','blocktime','fee','source','destination','misc1','uiAmount']
                //     const values = [`'${program}'`,`'${instructionType}'`,`'${signature}'`,`'${err}'`,slot,blocktime,fee,`'${from}'`,`'${to}'`,`'${seed}'`,`'${uiAmount}'`];
                //     console.log(`${program},${instructionType},${signature},${err},${slot},${blocktime},${fee},,,,${from},${to},,${seed},,${uiAmount}`);
  
                // }
                // else if (instructionType == 'transfer') {
                if (instructionType == 'transfer') {
                    let deserialized;
                    try {
                      deserialized = TransferLayout.decode(ix);
                    } catch (err) {
                      console.log(err);
                    }
                    const lamports = Number(deserialized.lamports);
                    const uiAmount = lamports / LAMPORTS_PER_SOL
                    const from = data?.transaction.message.accountKeys[instruction.accounts[0]]
                    const to = data?.transaction.message.accountKeys[instruction.accounts[1]]
                    if (uiAmount > 999) {
                      const message = `${program},${instructionType},${signature},${err},${slot},${approximateBlocktime},${fee},,,,${(new PublicKey(from)).toBase58()},${(new PublicKey(to)).toString()},,,,${uiAmount}`;
                      const encodedHash = hashMessage(message);
                      const fields = ['program', 'type', 'signature', 'err', 'blocktime', 'fee', 'source', 'destination', 'uiAmount', 'serial']
                      const values = [`'${program}'`,`'${instructionType}'`,`'${signature}'`,`'${err}'`,approximateBlocktime,fee,`'${(new PublicKey(from)).toBase58()}'`,`'${(new PublicKey(to)).toBase58()}'`,uiAmount,`'${encodedHash}'`];
                      await insertData(signature, fields, values);
                      console.log(`${program},${instructionType},${signature},${err},${slot},${approximateBlocktime},${fee},,,,${from},${to},,,,${uiAmount}`);
                    }
                }
            } 
            // else if (program == 'spl-token') {
            //     const prefix2 = ix.slice(0,1);
            //     const disc = (Buffer.from(prefix2)).readUInt8()
            //     const instructionType = MethodMap.get(`${program}_${disc}`)
  
            //     // console.log(`source = instruction.accounts[0]: ${instruction.accounts[0]}`);
            //     // console.log(`mint = instruction.accounts[1]: ${instruction.accounts[1]}`);
            //     // console.log(`destination = instruction.accounts[2]: ${instruction.accounts[2]}`);
            //     // console.log(`authority = instruction.accounts[3]: ${instruction.accounts[3]}`);
  
            //     if (instructionType == 'transfer') {
            //         const source = data?.transaction.message.accountKeys[instruction.accounts[0]]
            //         // const mint = data?.transaction.message.accountKeys[instruction.accounts[1]] // not available info?
            //         const destination = data?.transaction.message.accountKeys[instruction.accounts[1]]
            //         const authority = data?.transaction.message.accountKeys[instruction.accounts[2]]
            //         let deserialized;
            //         try {
            //           deserialized = TokenTransferLayout.decode(ix);
            //         } catch (err) {
            //           console.log(err);
            //         }
            //         const amount = Number(deserialized.amount); // wrong
            //         const decimals = 0 // Number(deserialized.decimals); // wrong FIX THIS -- NO DECIMALS AVAILABLE?
            //         const uiAmount = amount / 10 ** decimals; // FIX THIS
            //         // const fields = ['program','type','signature','err','slot','blocktime','fee','authority','source','destination','misc1','misc2','uiAmount']
            //         // const values = [`'${program}'`,`'${instructionType}'`,`'${signature}'`,`'${err}'`,slot,blocktime,fee,`'${(new PublicKey(authority)).toBase58()}'`,`'${(new PublicKey(source)).toBase58()}'`,`'${(new PublicKey(destination)).toBase58()}'`,`'${(new PublicKey(mint)).toBase58()}'`,decimals,uiAmount];
            //         console.log(`${program},${instructionType},${signature},${err},${slot},${blocktime},${fee},${authority},,,${source},${destination},,,${decimals},${uiAmount}`);
            //     } 
            //     else if (instructionType == 'transferChecked') {
            //         const source = data?.transaction.message.accountKeys[instruction.accounts[0]]
            //         const mint = data?.transaction.message.accountKeys[instruction.accounts[1]]
            //         const destination = data?.transaction.message.accountKeys[instruction.accounts[2]]
            //         const authority = data?.transaction.message.accountKeys[instruction.accounts[3]]
            //         let deserialized;
            //         try {
            //           deserialized = TokenTransferCheckedLayout.decode(ix);
            //         } catch (err) {
            //           console.log(err);
            //         }
            //         const amount = Number(deserialized.amount);
            //         const decimals = Number(deserialized.decimals);
            //         const uiAmount = amount / 10 ** decimals;
            //         // const fields = ['program','type','signature','err','slot','blocktime','fee','authority','source','destination2','misc1','misc2','uiAmount']
            //         // const values = [`'${program}'`,`'${instructionType}'`,`'${signature}'`,`'${err}'`,slot,blocktime,fee,`'${(new PublicKey(authority)).toBase58()}'`,`'${(new PublicKey(source)).toBase58()}'`,`'${(new PublicKey(destination)).toBase58()}'`,`'${(new PublicKey(mint)).toBase58()}'`,decimals,uiAmount];
            //         console.log(`${program},${instructionType},${signature},${err},${slot},${blocktime},${fee},${authority},,,${source},${destination},,${mint},${decimals},${uiAmount}`);
            //     }
            // }
            else {
                // console.log(`No result: ${signature} not a stake-related tx`);
            }
        });
    } catch (err) {
        console.log(err);
    }
  }


// Function to send a request to the WebSocket server
function sendRequest(ws) {
    const request = {
        jsonrpc: "2.0",
        id: 420,
        method: "transactionSubscribe",
        params: [
            {
                "vote": false,
                "failed": false,
                accountInclude: ["11111111111111111111111111111111"]
                // accountInclude: ["Stake11111111111111111111111111111111111111","Vote111111111111111111111111111111111111111"]
                // accountInclude: ["Vote111111111111111111111111111111111111111"]
                //accountInclude: ["5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9"]
                
            },
            {
                commitment: "confirmed", // processed, confirmed, finalized
                // encoding: "base64",
                encoding: "json", // `binary`, `base64`, `base58`, `json`, `jsonParsed`
                transactionDetails: "full",
                showRewards: true,
                maxSupportedTransactionVersion: 0
            }
        ]
    };
    ws.send(JSON.stringify(request));
}


// Define WebSocket event handlers
let connectionAttemptCount = 0;
ws.on('open', function open() {
    console.log('WebSocket is open');
    sendRequest(ws);  // Send a request once the WebSocket is open
});

ws.on('message', function incoming(data) {
    const messageStr = data.toString('utf8');
    try {
        const messageObj = JSON.parse(messageStr);
        insertParsedTransaction(messageObj);
    } catch (e) {
        console.error('Failed to parse JSON:', e);
    }
});

ws.on('error', function error(err) {
    console.error('WebSocket error:', err);
    connectionAttemptCount++;
    if (connectionAttemptCount < 5) {
        console.log('Attempting to reconnect to WebSocket');
        ws = reconnectWebSocket(); // Reconnect the WebSocket
    } else {
        console.error('Failed to reconnect to WebSocket after 5 attempts');
    }
});

// Define a function to reconnect the WebSocket
function reconnectWebSocket() {
    // Logic to re-establish the WebSocket connection
    const newWs = new WebSocket(process.env.HELIUS_WEBSOCKETS_URL);
    // Add event handlers to the new WebSocket
    newWs.on('open', function open() {
        console.log('Reconnected to WebSocket');
        sendRequest(newWs);  // Send a request once the WebSocket is open
    });
    // Add other event handlers as needed
    // ...
    return newWs;
}

// Add the reconnect logic to the 'close' event handler
ws.on('close', function close() {
    console.log('WebSocket is closed');``
    ws = reconnectWebSocket(); // Reconnect the WebSocket
});