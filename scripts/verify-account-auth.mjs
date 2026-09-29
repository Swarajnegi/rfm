// Exercises the REAL SDK and UI against fake HTTP, never sends an email or user data.
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width:390,height:844 } });
  await context.addInitScript(() => {
    localStorage.setItem('corpus_alerts_enabled','false');
    localStorage.setItem('rfm_v1', JSON.stringify({version:'3.0',investments:[],networth:{bank:20000},profile:{version:2,name:'Test',completedAt:'2026-09-27'}}));
  });
  let sent = 0, verified = 0, writes = 0, row = null, googleRequest = null;
  const user = { id:'00000000-0000-4000-8000-000000000001', email:'test@example.com', aud:'authenticated', role:'authenticated', app_metadata:{provider:'email'},user_metadata:{},created_at:new Date().toISOString() };
  const jwt = [ {alg:'HS256',typ:'JWT'}, {sub:user.id,aud:'authenticated',exp:Math.floor(Date.now()/1000)+3600} ].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.') + '.signature';
  await context.route('**/*', async r => {
    const u = new URL(r.request().url());
    const reply = data => r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
    if (u.hostname === 'corpus.test') {
      if (u.pathname === '/account-config.js') return r.fulfill({contentType:'text/javascript',body:'window.CORPUS_ACCOUNT_CONFIG={url:"https://accounts.test",publishableKey:"sb_publishable_test",googleEnabled:true,emailEnabled:true};'});
      const file = u.pathname === '/' ? 'index.html' : u.pathname.slice(1);
      if (file.includes('..')) return r.abort();
      try {
        const mime = file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream';
        return r.fulfill({contentType:mime,body:await readFile(path.resolve('web',file))});
      } catch { return r.abort(); }
    }
    if (u.hostname !== 'accounts.test') return r.abort();
    if (u.pathname === '/auth/v1/authorize') {
      googleRequest = Object.fromEntries(u.searchParams);
      return r.fulfill({contentType:'text/html',body:'<p>Mock Google sign-in</p>'});
    }
    if (u.pathname === '/auth/v1/otp') { sent++; assert.equal(r.request().postDataJSON().email,user.email); return reply({}); }
    if (u.pathname === '/auth/v1/verify') {
      verified++;
      assert.equal(r.request().postDataJSON().type,'email');
      assert.equal(r.request().postDataJSON().email,user.email);
      if (r.request().postDataJSON().token !== '123456') return r.fulfill({status:403,contentType:'application/json',body:JSON.stringify({code:'otp_expired',msg:'Token has expired or is invalid'})});
      return reply({user,access_token:jwt,refresh_token:'test-refresh',token_type:'bearer',expires_in:3600});
    }
    if (u.pathname === '/rest/v1/corpus_portfolios') return reply(row);
    if (u.pathname === '/rest/v1/rpc/corpus_save_portfolio') {
      writes++; const data = r.request().postDataJSON();
      if ((row?.revision || 0) !== data.expected_revision) return reply([]);
      row={user_id:user.id,revision:data.expected_revision+1,document:data.new_document,updated_at:new Date().toISOString()};
      return reply([row]);
    }
    if (u.pathname === '/auth/v1/logout') return reply({});
    return r.abort();
  });
  const page = await context.newPage(), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',d=>d.accept());
  await page.goto('https://corpus.test/');
  await page.waitForFunction(()=>window.Alpine?.store('account')?.enabled);
  await page.evaluate(()=>document.querySelector('[x-data]')._x_dataStack[0].activePage='settings');
  await page.getByRole('checkbox',{name:/I understand/}).check();
  await page.getByRole('button',{name:'Continue with Google'}).click();
  await page.waitForURL('https://accounts.test/auth/v1/authorize**');
  assert.equal(googleRequest.provider, 'google');
  assert.equal(googleRequest.redirect_to, 'https://corpus.test/');
  assert.equal(googleRequest.code_challenge_method, 's256');
  assert.match(googleRequest.code_challenge, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(writes, 0, 'Google initiation does not upload guest data');
  await page.goto('https://corpus.test/');
  await page.waitForFunction(()=>window.Alpine?.store('account')?.enabled);
  await page.evaluate(()=>document.querySelector('[x-data]')._x_dataStack[0].activePage='settings');
  await page.getByRole('checkbox',{name:/I understand/}).check();
  await page.getByLabel('Email address',{exact:true}).fill(user.email);
  await page.getByRole('button',{name:'Send email code'}).click();
  await page.getByLabel('One-time email code').waitFor({state:'visible'});
  assert.equal(sent,1);
  await page.getByRole('button',{name:'Resend code',exact:true}).click();
  await page.waitForFunction(()=>Alpine.store('account').error.includes('Wait one minute'));
  assert.equal(sent,1,'cooldown must not send another email');
  await page.getByLabel('One-time email code').fill('000000');
  await page.getByRole('button',{name:'Verify code'}).click();
  await page.waitForFunction(()=>Alpine.store('account').error.includes('invalid or expired'));
  assert.equal(writes,0,'invalid code cannot upload data');
  assert.equal(await page.getByLabel('One-time email code').inputValue(),'');
  // Advance only the local resend clock, not real time or the production service.
  await page.evaluate(()=>{Alpine.store('account').retryAt=0;});
  await page.getByRole('button',{name:'Resend code',exact:true}).click();
  await page.waitForFunction(()=>!Alpine.store('account').busy && !Alpine.store('account').error);
  assert.equal(sent,2);
  await page.locator('.account-card').scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(os.tmpdir(),'corpus-email-code.png')});
  await page.getByLabel('One-time email code').fill('123456');
  await page.getByRole('button',{name:'Verify code'}).click();
  await page.getByRole('button',{name:'Connect this portfolio'}).waitFor();
  assert.equal(sent,2); assert.equal(verified,2); assert.equal(writes,0,'no upload on login');
  await page.getByRole('button',{name:'Connect this portfolio'}).click();
  await page.waitForFunction(()=>['saved','equal'].includes(Alpine.store('account').status));
  assert.equal(row.document.portfolio.networth.bank,20000);
  await page.evaluate(()=>{const d=document.querySelector('[x-data]')._x_dataStack[0];d.networth.bank=25000;d.saveData();});
  await page.waitForFunction(()=>Alpine.store('account').status==='saved');
  assert.equal(row.document.portfolio.networth.bank,25000);
  const before=writes;
  await context.setOffline(true);
  await page.evaluate(()=>{const d=document.querySelector('[x-data]')._x_dataStack[0];d.networth.bank=30000;d.saveData();});
  await page.waitForFunction(()=>Alpine.store('account').notice.startsWith('Offline'));
  assert.equal(writes,before);
  await context.setOffline(false);
  await page.waitForFunction(()=>Alpine.store('account').status==='saved');
  assert.equal(row.document.portfolio.networth.bank,30000);
  assert.deepEqual(errors,[]);
  console.log('PASS: real SDK Google PKCE and email-code flow (mock server), invalid/expired code, resend cooldown/recovery, explicit upload consent, debounced edits, offline queue, reconnect sync.');
} finally { await browser.close(); }
