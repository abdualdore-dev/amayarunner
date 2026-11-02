importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');
firebase.initializeApp({apiKey:'AIzaSyBrin3-ise3Lsd7zOM5cog9SaZ4SCiMPPg',authDomain:'amaya-runner.firebaseapp.com',projectId:'amaya-runner',messagingSenderId:'965390885306',appId:'1:965390885306:web:5765ca8c898757b2507d83'});
const messaging = firebase.messaging();
messaging.onBackgroundMessage(payload => {
  const d = payload.data || {};
  const ar = (self.navigator && self.navigator.language || '').startsWith('ar');
  const title = ar ? (d.title_ar || d.title_en) : (d.title_en || d.title_ar);
  const body = ar ? (d.body_ar || d.body_en) : (d.body_en || d.body_ar);
  self.registration.showNotification(title || 'Amaya Heroes', { body: body || '', tag: 'amaya', renotify: true, vibrate: [200, 100, 200], dir: ar ? 'rtl' : 'ltr' });
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.openWindow('/'));
});
