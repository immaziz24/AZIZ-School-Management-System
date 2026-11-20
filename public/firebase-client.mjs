import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';

const firebaseConfig = {
  apiKey: 'AIzaSyCvDiFf5g2Mo1xyCq0vstwQGhqdHl5TrEE',
  authDomain: 'aziz-school-management-system.firebaseapp.com',
  projectId: 'aziz-school-management-system',
  storageBucket: 'aziz-school-management-system.firebasestorage.app',
  messagingSenderId: '1024878694489',
  appId: '1:1024878694489:web:d9af57311eef76415c6148',
  measurementId: 'G-L2PYNPGFR8',
};

export const app = initializeApp(firebaseConfig);

// App Check (feature 108). Leave the key empty until the reCAPTCHA v3 site key is created and the app is registered in the
// Firebase console (Build > App Check). With a key, every database and sign-in request carries a proof that it came from this
// site. Turn on enforcement in the console only after the console shows the traffic as verified.
const APP_CHECK_SITE_KEY = '';
if (APP_CHECK_SITE_KEY) {
  try {
    const { initializeAppCheck, ReCaptchaV3Provider } = await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-app-check.js');
    initializeAppCheck(app, { provider: new ReCaptchaV3Provider(APP_CHECK_SITE_KEY), isTokenAutoRefreshEnabled: true });
  } catch {
    // The app still works when App Check cannot start; enforcement is the only thing that would then block requests.
  }
}
