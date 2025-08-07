import * as admin from 'firebase-admin';
import dotenv from 'dotenv';

dotenv.config();

let firebaseApp: admin.app.App;
let db: admin.firestore.Firestore;

if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
  firebaseApp = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL
  });
} else {
  throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY environment variable is required');
}

db = admin.firestore();

// Configure Firestore to ignore undefined properties
db.settings({
  ignoreUndefinedProperties: true
});

export { firebaseApp, db, admin };