import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fsPromises from 'fs/promises';
import { watch, FSWatcher } from 'fs';
import os from 'os';
import crypto from 'crypto';
import logger from '../../utils/logger.js';

// Get the directory name of the current module
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Define cleanupResources outside the promise to be accessible in the final catch
async function cleanupResources(responsePath: string, optionsPath: string) {
  await Promise.allSettled([
    fsPromises.unlink(responsePath).catch(() => {}),
    fsPromises.unlink(optionsPath).catch(() => {}),
  ]);
}

/**
 * Display a command window with a prompt and return user input
 * @param projectName Name of the project requesting input (used for title)
 * @param promptMessage Message to display to the user
 * @param predefinedOptions Optional list of predefined options for quick selection
 * @returns User input or empty string if process closed
 */
export async function getCmdWindowInput(
  projectName: string,
  promptMessage: string,
  predefinedOptions?: string[],
): Promise<string> {
  // Create a temporary file for the detached process to write to
  const sessionId = crypto.randomBytes(8).toString('hex');
  const tempDir = os.tmpdir();
  const tempFilePath = path.join(tempDir, `cmd-ui-response-${sessionId}.txt`);
  const optionsFilePath = path.join(
    tempDir,
    `cmd-ui-options-${sessionId}.json`,
  );

  return new Promise<string>((resolve) => {
    // Wrap the async setup logic in an IIFE
    void (async () => {
      // Path to the UI script (will be in the same directory after compilation)
      const uiScriptPath = path.join(__dirname, 'ui.js');

      // Gather options
      const options = {
        projectName,
        prompt: promptMessage,
        sessionId,
        outputFile: tempFilePath,
        predefinedOptions,
      };

      let ui;

      // Moved setup into try block
      try {
        // Write options to the file before spawning
        await fsPromises.writeFile(
          optionsFilePath,
          JSON.stringify(options),
          'utf8',
        );

        // Platform-specific spawning
        const platform = os.platform();

        if (platform === 'darwin') {
          // macOS
          const escapedScriptPath = uiScriptPath;
          const escapedSessionId = sessionId; // Only need sessionId now

          // Construct the command string directly for the shell. Quotes handle paths with spaces.
          // Pass only the sessionId
          const nodeBin = process.execPath;
          const nodeCommand = `exec "${nodeBin}" "${escapedScriptPath}" "${escapedSessionId}" "${tempDir}"; exit 0`;

          // Escape the node command for osascript's AppleScript string:
          const escapedNodeCommand = nodeCommand
            .replace(/\\/g, '\\\\') // Escape backslashes
            .replace(/"/g, '\\"'); // Escape double quotes

          // Activate Terminal first, then do script with exec
          const command = `osascript -e 'tell application "Terminal" to activate' -e 'tell application "Terminal" to do script "${escapedNodeCommand}"'`;
          const commandArgs: string[] = [];

          // Fallback launcher using .command + open -a Terminal (handles Automation issues)
          const launchViaOpenCommand = async () => {
            try {
              const launcherPath = path.join(
                tempDir,
                `interactive-mcp-launch-${sessionId}.command`,
              );
              const scriptContent = `#!/bin/bash\nexec "${nodeBin}" "${escapedScriptPath}" "${escapedSessionId}" "${tempDir}"\n`;
              await fsPromises.writeFile(launcherPath, scriptContent, 'utf8');
              await fsPromises.chmod(launcherPath, 0o755);
              const openProc = spawn('open', ['-a', 'Terminal', launcherPath], {
                stdio: ['ignore', 'ignore', 'ignore'],
                detached: true,
              });
              openProc.unref();
            } catch (e) {
              logger.error({ error: e }, 'Fallback open -a Terminal failed');
            }
          };

          ui = spawn(command, commandArgs, {
            stdio: ['ignore', 'ignore', 'ignore'],
            shell: true,
            detached: true,
          });

          // If AppleScript fails or exits non-zero, fallback to open -a Terminal
          ui.on('error', () => {
            void launchViaOpenCommand();
          });
          ui.on('close', (code: number | null) => {
            if (code !== null && code !== 0) {
              void launchViaOpenCommand();
            }
          });
        } else if (platform === 'win32') {
          // Windows
          // Pass sessionId and tempDir
          logger.debug(
            { execPath: process.execPath, uiScriptPath, sessionId, tempDir },
            'Spawning Windows UI process',
          );
          ui = spawn(process.execPath, [uiScriptPath, sessionId, tempDir], {
            stdio: ['ignore', 'ignore', 'ignore'],
            shell: true,
            detached: true,
            windowsHide: false,
          });
        } else {
          // Linux or other
          // Pass sessionId and tempDir
          logger.debug(
            { execPath: process.execPath, uiScriptPath, sessionId, tempDir },
            'Spawning Linux/Other UI process',
          );
          ui = spawn(process.execPath, [uiScriptPath, sessionId, tempDir], {
            stdio: ['ignore', 'ignore', 'ignore'],
            shell: true,
            detached: true,
          });
        }

        let watcher: FSWatcher | null = null;

        // Define cleanupAndResolve inside the promise scope
        const cleanupAndResolve = async (response: string) => {
          if (watcher) {
            watcher.close();
            watcher = null;
          }

          await cleanupResources(tempFilePath, optionsFilePath);

          resolve(response);
        };

        // Listen for process exit events - moved definition before IIFE start
        const handleExit = (code?: number | null) => {
          // If the process exited with a non-zero code and watcher still exists
          if (code !== 0 && watcher) {
            logger.warn(
              { code, sessionId },
              'UI process exited with non-zero code',
            );
            void cleanupAndResolve('');
          }
        };

        const handleError = (error: Error) => {
          logger.error({ error, sessionId }, 'UI process encountered an error');
          if (watcher) {
            // Only cleanup if not already cleaned up
            void cleanupAndResolve('');
          }
        };

        ui.on('exit', handleExit);
        ui.on('error', handleError);

        // Unref the child process so the parent can exit independently
        ui.unref();

        // Create an empty temp file before watching for user response
        await fsPromises.writeFile(tempFilePath, '', 'utf8');
        logger.debug({ tempFilePath, optionsFilePath }, 'Created temp files');

        // Watch for content being written to the temp file
        watcher = watch(tempFilePath, (eventType: string) => {
          if (eventType === 'change') {
            // Read the response and cleanup
            void (async () => {
              try {
                const data = await fsPromises.readFile(tempFilePath, 'utf8');
                if (data) {
                  const response = data.trim();
                  logger.debug(
                    { response, sessionId },
                    'Received user response',
                  );
                  void cleanupAndResolve(response);
                }
              } catch (readError) {
                logger.error(
                  { err: readError, sessionId },
                  'Error reading response file',
                );
                void cleanupAndResolve('');
              }
            })();
          }
        });
      } catch (setupError) {
        logger.error({ error: setupError }, 'Error during cmd-input setup');
        // Ensure cleanup happens even if setup fails
        await cleanupResources(tempFilePath, optionsFilePath);
        resolve('');
      }
    })(); // Execute the IIFE
  });
}
