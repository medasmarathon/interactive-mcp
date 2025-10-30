import { z } from 'zod';
import {
  ToolDefinition,
  ToolCapabilityInfo,
  ToolRegistrationDescription,
} from './types.js'; // Import the types

// Define capability conforming to ToolCapabilityInfo
const capabilityInfo: ToolCapabilityInfo = {
  description:
    'Send a question to the user via a pop-up command prompt and await their reply.',
  parameters: {
    type: 'object',
    properties: {
      projectName: {
        type: 'string',
        description:
          'Identifies the context/project making the request (used in prompt formatting)',
      },
      message: {
        type: 'string',
        description:
          'The specific question for the user (appears in the prompt)',
      },
      predefinedOptions: {
        type: 'array',
        items: { type: 'string' },
        optional: true, // Mark as optional here too for consistency
        description:
          'Predefined options for the user to choose from (optional)',
      },
    },
    required: ['projectName', 'message'],
  },
};

// Define description conforming to ToolRegistrationDescription
const registrationDescription: ToolRegistrationDescription = `Interactive feedback collection tool for LLM agents.

    USAGE RULES:
    1. During any process, task, or conversation, whether asking, replying, or completing phased tasks, you must call this tool to ask for feedback.
    2. Unless receiving termination instructions, all steps must repeatedly call this tool.
    3. Whenever user feedback is received, if the feedback content is not empty, you must call this tool again and adjust behavior based on the feedback content.
    4. Only when the user explicitly indicates "end" or "no more interaction needed" can you stop calling this tool, and the process is considered complete.

<features>
- Pop-up command prompt display for user input
- Waits indefinitely for user response until they provide input
- Maintains context across user interactions
- Handles empty responses gracefully
- Properly formats prompt with project context
</features>

<bestPractices>
- Keep questions concise and specific
- Provide clear options when applicable
- Limit questions to only what's necessary **to resolve the uncertainty**
- Format complex questions into simple choices
- Reference specific code or files when relevant
- Indicate why the information is needed
- Use appropriate urgency based on importance
</bestPractices>

<parameters>
- projectName: Identifies the context/project making the request (used in prompt formatting)
- message: The specific question for the user (appears in the prompt)
- predefinedOptions: Predefined options for the user to choose from (optional)
</parameters>

<examples>
- "Should I implement the authentication using JWT or OAuth?"
- "Do you want to use TypeScript interfaces or type aliases for this component?"
- "I found three potential bugs. Should I fix them all or focus on the critical one first?"
- "Can I refactor the database connection code to use connection pooling?"
- "Is it acceptable to add React Router as a dependency?"
- "I plan to modify function X in file Y. Is that correct?"
</examples>`;

// Define the Zod schema (as a raw shape object)
const rawSchema: z.ZodRawShape = {
  projectName: z
    .string()
    .describe(
      'Identifies the context/project making the request (used in prompt formatting)',
    ),
  message: z
    .string()
    .describe('The specific question for the user (appears in the prompt)'),
  predefinedOptions: z
    .array(z.string())
    .optional()
    .describe('Predefined options for the user to choose from (optional)'),
};

// Combine into a single ToolDefinition object
export const requestUserInputTool: ToolDefinition = {
  capability: capabilityInfo,
  description: registrationDescription,
  schema: rawSchema, // Use the raw shape here
};
