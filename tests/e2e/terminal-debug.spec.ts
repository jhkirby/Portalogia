import { test, expect } from './fixtures';

test('debug terminal', async ({ window, electronApp }) => {
  const mainOutput: string[] = [];
  electronApp.process().stdout?.on('data', (chunk: Buffer) => mainOutput.push(chunk.toString()));
  electronApp.process().stderr?.on('data', (chunk: Buffer) => mainOutput.push(chunk.toString()));

  const consoleMessages: string[] = [];
  window.on('console', (msg) => consoleMessages.push(`[${msg.type()}] ${msg.text()}`));
  window.on('pageerror', (err) => consoleMessages.push(`[pageerror] ${err.message}`));

  await window.getByRole('button', { name: 'New terminal' }).click();
  await window.waitForTimeout(2000);

  const rowsText = await window.evaluate(() => {
    const screen = document.querySelector('.terminal--active .xterm-screen');
    const rows = document.querySelector('.terminal--active .xterm-rows');
    return {
      rowsExists: !!rows,
      rowsText: rows ? rows.textContent : 'NO ROWS FOUND',
      screenHTML: screen ? screen.innerHTML : 'NO SCREEN',
    };
  });

  expect(
    JSON.stringify({ rowsText, consoleMessages }, null, 2),
  ).toEqual('FORCE_FAILURE_TO_SHOW_DIFF');
});
