const readline = require('readline');

/**
 * Prompts the operator in the terminal for OTP and waits for input.
 * Times out after timeoutMs (default: 60,000ms / 60s).
 *
 * @param {string} promptMessage
 * @param {number} timeoutMs
 * @returns {Promise<string>}
 */
function promptOtp(promptMessage = 'Enter OTP: ', timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    let isResolved = false;

    const timer = setTimeout(() => {
      if (!isResolved) {
        isResolved = true;
        rl.close();
        reject(new Error(`Timed out waiting for OTP entry after ${timeoutMs / 1000}s`));
      }
    }, timeoutMs);

    rl.question(promptMessage, (answer) => {
      if (!isResolved) {
        isResolved = true;
        clearTimeout(timer);
        rl.close();
        const trimmed = answer ? answer.trim() : '';
        if (!trimmed) {
          reject(new Error('No OTP entered.'));
        } else {
          resolve(trimmed);
        }
      }
    });

    rl.on('error', (err) => {
      if (!isResolved) {
        isResolved = true;
        clearTimeout(timer);
        rl.close();
        reject(err);
      }
    });
  });
}

module.exports = { promptOtp };
