// Starts Alpine AFTER app.js has registered its alpine:init listener.
// Splitting this out of vendor.js is what preserves the ordering contract that
// the old CDN setup got for free by putting the Alpine <script> last.
window.Alpine.start();
