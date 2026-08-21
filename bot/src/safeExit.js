async function safeExit(browser) {
  try {
    if (browser) await browser.close();
    console.log('Browser session closed cleanly.');
  } catch (err) {
    console.error('safeExit error (already closed?):', err.message);
  }
}

module.exports = { safeExit };
