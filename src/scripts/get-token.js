const { google } = require('googleapis');
const http = require('http');
const url = require('url');
require('dotenv').config();

const oauth2Client = new google.auth.OAuth2(
  '329353307637-dv2qucsg3djlslpoj80jmrahgfq9bgo0.apps.googleusercontent.com',
  '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',
  'http://localhost:3000/oauth2callback'
);

const scopes = [
  'https://www.googleapis.com/auth/calendar'
];

const authorizeUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: scopes,
  prompt: 'consent'
});

console.log('\n📋 Copy and paste this URL in your browser:\n');
console.log(authorizeUrl);
console.log('\n');

const server = http.createServer(async (req, res) => {
  if (req.url.indexOf('/oauth2callback') > -1) {
    const qs = new url.URL(req.url, 'http://localhost:3000').searchParams;
    const code = qs.get('code');
    
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h1>Authentication successful!</h1><p>You can close this window and return to terminal.</p>');
    server.close();

    try {
      const { tokens } = await oauth2Client.getToken(code);
      console.log('\n✅ Success! Add this to your .env file:\n');
      console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
      console.log('\nYour complete Google Calendar config in .env:');
      console.log(`GOOGLE_CLIENT_ID=329353307637-dv2qucsg3djlslpoj80jmrahgfq9bgo0.apps.googleusercontent.com`);
      console.log(`GOOGLE_CLIENT_SECRET=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`);
      console.log(`GOOGLE_REDIRECT_URI=http://localhost:3000/oauth2callback`);
      console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
      process.exit(0);
    } catch (error) {
      console.error('Error getting token:', error);
      process.exit(1);
    }
  }
}).listen(3000, () => {
  console.log('Waiting for authorization...\n');
});