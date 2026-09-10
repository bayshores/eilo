"use strict";
const ORIGIN = "http://127.0.0.1:8765";

function localURL(value) {
  try { const url = new URL(value); return url.origin === ORIGIN && !url.username && !url.password; }
  catch { return false; }
}

function homeURL(value) {
  if (!localURL(value)) return false;
  return ["/home/", "/home/index.html"].includes(new URL(value).pathname);
}

function audioRequest({permission, url, mainFrame, focused, mediaTypes}) {
  return permission === "media" && homeURL(url) && mainFrame === true && focused === true
    && Array.isArray(mediaTypes) && mediaTypes.length === 1 && mediaTypes[0] === "audio";
}

function checkInTarget(value) {
  if (!value || typeof value !== "object") return null;
  const keys = ["conversationId", "messageId", "eventId"];
  if (!keys.every(key => typeof value[key] === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value[key]))) return null;
  return Object.fromEntries(keys.map(key => [key, value[key]]));
}

function googleAuthorizationURL(value) {
  try {
    const url=new URL(value),p=url.searchParams,redirect=new URL(p.get('redirect_uri'));
    const fields=['client_id','redirect_uri','response_type','scope','code_challenge','code_challenge_method','state','access_type','prompt'];
    const scopes=['openid','email','https://www.googleapis.com/auth/calendar.calendarlist.readonly','https://www.googleapis.com/auth/calendar.events.readonly'];
    return url.origin==='https://accounts.google.com'&&url.pathname==='/o/oauth2/v2/auth'&&!url.hash&&!url.username&&!url.password
      &&[...p.keys()].length===fields.length&&fields.every(k=>p.has(k))
      &&/^[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(p.get('client_id'))
      &&p.get('scope').split(' ').sort().join(' ')===scopes.sort().join(' ')
      &&p.get('response_type')==='code'&&p.get('access_type')==='offline'&&p.get('prompt')==='consent select_account'
      &&p.get('code_challenge_method')==='S256'&&/^[A-Za-z0-9_-]{43}$/.test(p.get('code_challenge'))&&/^[A-Za-z0-9_-]{43}$/.test(p.get('state'))
      &&redirect.protocol==='http:'&&redirect.hostname==='127.0.0.1'&&Number(redirect.port)>=1024&&Number(redirect.port)<=65535
      &&redirect.pathname==='/callback'&&!redirect.search&&!redirect.hash&&!redirect.username&&!redirect.password;
  } catch {return false;}
}

function briefingAuthorizationURL(value) {
  try {
    const url=new URL(value),p=url.searchParams,redirect=new URL(p.get('redirect_uri'));
    const fields=['client_id','redirect_uri','response_type','scope','code_challenge','code_challenge_method','state','access_type','prompt'];
    const scopes=['openid','email','https://www.googleapis.com/auth/gmail.readonly'];
    return url.origin==='https://accounts.google.com'&&url.pathname==='/o/oauth2/v2/auth'&&!url.hash&&!url.username&&!url.password
      &&[...p.keys()].length===fields.length&&fields.every(k=>p.has(k))
      &&/^[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(p.get('client_id'))
      &&p.get('scope').split(' ').sort().join(' ')===scopes.sort().join(' ')
      &&p.get('response_type')==='code'&&p.get('access_type')==='offline'&&p.get('prompt')==='consent select_account'
      &&p.get('code_challenge_method')==='S256'&&/^[A-Za-z0-9_-]{43}$/.test(p.get('code_challenge'))&&/^[A-Za-z0-9_-]{43}$/.test(p.get('state'))
      &&redirect.protocol==='http:'&&redirect.hostname==='127.0.0.1'&&Number(redirect.port)>=1024&&Number(redirect.port)<=65535
      &&redirect.pathname==='/callback'&&!redirect.search&&!redirect.hash&&!redirect.username&&!redirect.password;
  } catch {return false;}
}

function briefingSourceURL(value) {
  try {
    const u=new URL(value);
    if(u.protocol!=='https:'||u.username||u.password||u.port)return false;
    if(u.hostname==='mail.google.com')return u.pathname==='/mail/u/'&&[...u.searchParams.keys()].join(',')==='authuser'
      &&/^[^\s@]+@[^\s@]+$/.test(u.searchParams.get('authuser'))&&/^#all\/[A-Za-z0-9_-]{1,1024}$/.test(u.hash);
    return u.href==='https://calendar.google.com/calendar/u/0/r';
  } catch {return false;}
}

module.exports = {ORIGIN, localURL, homeURL, audioRequest, checkInTarget, googleAuthorizationURL, briefingAuthorizationURL, briefingSourceURL};
