import '../server/config.mjs';
import { createInterface, emitKeypressEvents } from 'node:readline';
import { clientFor, requireOwner, result } from '../server/cloud-client.mjs';
import { ownerEmail } from '../server/config.mjs';

export async function ownerLogin() {
  if(!process.stdin.isTTY)throw new Error('Run this command in an interactive terminal. Your password is entered privately, not in chat or command arguments.');
  process.stdout.write(`Sign in as ${ownerEmail}\nGather account password: `);
  emitKeypressEvents(process.stdin);process.stdin.setRawMode(true);process.stdin.resume();
  const password=await new Promise((resolve,reject)=>{
    let value='';
    const input=(str,key)=>{
      if(key?.ctrl&&key.name==='c'){cleanup();reject(new Error('Cancelled.'));return;}
      if(key?.name==='return'){cleanup();resolve(value);return;}
      if(key?.name==='backspace'){value=value.slice(0,-1);return;}
      if(str&&!key?.ctrl&&str.charCodeAt(0)>=32)value+=str;
    };
    function cleanup(){process.stdin.off('keypress',input);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');}
    process.stdin.on('keypress',input);
  });
  const client=clientFor();
  const {session,user}=result(await client.auth.signInWithPassword({email:ownerEmail,password}));
  await requireOwner(client,user);
  return {client,user,session};
}
