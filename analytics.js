// analytics.js — Analytics page functionality

document.addEventListener('DOMContentLoaded', () => {
  const backBtn = document.getElementById('back-btn');
  
  // Navigate back to main popup
  backBtn.addEventListener('click', () => {
    // Replace the current HTML with the main popup
    window.location.href = 'popup.html';
  });
});
