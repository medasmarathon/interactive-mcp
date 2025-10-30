import React, { FC, useEffect } from 'react';
import { render, Box, Text, useApp } from 'ink';
import fs from 'fs/promises';
import path from 'path'; // Import path module
import os from 'os'; // Import os module for tmpdir
import logger from '../../utils/logger.js';
import { InteractiveInput } from '../../components/InteractiveInput.js'; // Import shared component

interface CmdOptions {
  projectName?: string;
  prompt: string;
  sessionId: string;
  outputFile: string;
  predefinedOptions?: string[];
}

// Define defaults separately
const defaultOptions = {
  prompt: 'Enter your response:',
  projectName: undefined,
  predefinedOptions: undefined,
};

// Function to read options from the file specified by sessionId
const readOptionsFromFile = async (): Promise<CmdOptions> => {
  const args = process.argv.slice(2);
  const sessionId = args[0];

  if (!sessionId) {
    logger.error('No sessionId provided. Exiting.');
    throw new Error('No sessionId provided'); // Throw error to prevent proceeding
  }

  let tempDir = args[1];
  if (!tempDir) {
    tempDir = os.tmpdir();
  }

  const optionsFilePath = path.join(
    tempDir,
    `cmd-ui-options-${sessionId}.json`,
  );

  try {
    const optionsData = await fs.readFile(optionsFilePath, 'utf8');
    const parsedOptions = JSON.parse(optionsData) as Partial<CmdOptions>; // Parse as partial

    // Validate required fields after parsing
    if (!parsedOptions.sessionId || !parsedOptions.outputFile) {
      throw new Error('Required options missing in options file.');
    }

    // Merge defaults with parsed options, ensuring required fields are fully typed
    return {
      ...defaultOptions,
      ...parsedOptions,
      sessionId: parsedOptions.sessionId,
      outputFile: parsedOptions.outputFile,
    } as CmdOptions;
  } catch (error) {
    logger.error(
      {
        optionsFilePath,
        error: error instanceof Error ? error.message : String(error),
      },
      `Failed to read or parse options file ${optionsFilePath}`,
    );
    // Re-throw to ensure the calling code knows initialization failed
    throw error;
  }
};

// Function to write response to output file if provided
const writeResponseToFile = async (outputFile: string, response: string) => {
  if (!outputFile) return;
  // write file in UTF-8 format, errors propagate to caller
  await fs.writeFile(outputFile, response, 'utf8');
};

// Global state for options and exit handler setup
let options: CmdOptions | null = null;
let exitHandlerAttached = false;

// Async function to initialize options and setup exit handlers
async function initialize() {
  try {
    options = await readOptionsFromFile();
    // Setup exit handlers only once after options are successfully read
    if (!exitHandlerAttached) {
      const handleExit = () => {
        if (options && options.outputFile) {
          // Write empty string to indicate abnormal exit (e.g., Ctrl+C)
          writeResponseToFile(options.outputFile, '')
            .catch((error) => {
              logger.error({ error }, 'Failed to write exit file');
            })
            .finally(() => process.exit(0)); // Exit gracefully after attempting write
        } else {
          process.exit(0);
        }
      };

      process.on('SIGINT', handleExit);
      process.on('SIGTERM', handleExit);
      process.on('beforeExit', handleExit); // Catches graceful exits too
      exitHandlerAttached = true;
    }
  } catch (error) {
    logger.error({ error }, 'Initialization failed');
    process.exit(1); // Exit if initialization fails
  }
}

interface AppProps {
  options: CmdOptions;
}

const App: FC<AppProps> = ({ options: appOptions }) => {
  const { exit } = useApp();
  const { projectName, prompt, outputFile, predefinedOptions } = appOptions;

  // Clear console only once on mount
  useEffect(() => {
    console.clear();
  }, []);

  // Handle final submission
  const handleSubmit = (value: string) => {
    logger.debug(`User submitted: ${value}`);
    writeResponseToFile(outputFile, value) // Use outputFile from props
      .catch((err) => logger.error('Failed to write response file:', err))
      .finally(() => {
        exit(); // Use Ink's exit for normal submission
      });
  };

  // Wrapper for handleSubmit to match the signature of InteractiveInput's onSubmit
  const handleInputSubmit = (_questionId: string, value: string) => {
    handleSubmit(value);
  };

  return (
    <Box
      flexDirection="column"
      padding={1}
      borderStyle="round"
      borderColor="blue"
    >
      {projectName && (
        <Box marginBottom={1} justifyContent="center">
          <Text bold color="magenta">
            {projectName}
          </Text>
        </Box>
      )}
      <InteractiveInput
        question={prompt}
        questionId={prompt}
        predefinedOptions={predefinedOptions}
        onSubmit={handleInputSubmit}
      />
    </Box>
  );
};

// Initialize and render the app
initialize()
  .then(() => {
    if (options) {
      render(<App options={options} />);
    } else {
      // This case should theoretically not be reached due to error handling in initialize
      logger.error('Options could not be initialized. Cannot render App.');
      process.exit(1);
    }
  })
  .catch(() => {
    // Error already logged in initialize or readOptionsFromFile
    process.exit(1);
  });
