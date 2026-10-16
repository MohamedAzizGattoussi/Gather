import { run, hashPassword } from './db.mjs';
run('UPDATE settings SET value=? WHERE key=?', hashPassword(process.env.GATHER_INITIAL_PASSWORD || '123456789'), 'password');
run('DELETE FROM sessions');
console.log('Local password reset. Start Gather and sign in with the reset password.');
