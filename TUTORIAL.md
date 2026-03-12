---
title: "Build a Salesforce agent with LangChain (TypeScript) and Arcade"
slug: "ts-langchain-Salesforce"
framework: "langchain-ts"
language: "typescript"
toolkits: ["Salesforce"]
tools: []
difficulty: "beginner"
generated_at: "2026-03-12T01:34:49Z"
source_template: "ts_langchain"
agent_repo: ""
tags:
  - "langchain"
  - "typescript"
  - "salesforce"
---

# Build a Salesforce agent with LangChain (TypeScript) and Arcade

In this tutorial you'll build an AI agent using [LangChain](https://js.langchain.com/) with [LangGraph](https://langchain-ai.github.io/langgraphjs/) in TypeScript and [Arcade](https://arcade.dev) that can interact with Salesforce tools — with built-in authorization and human-in-the-loop support.

## Prerequisites

- The [Bun](https://bun.com) runtime
- An [Arcade](https://arcade.dev) account and API key
- An OpenAI API key

## Project Setup

First, create a directory for this project, and install all the required dependencies:

````bash
mkdir salesforce-agent && cd salesforce-agent
bun install @arcadeai/arcadejs @langchain/langgraph @langchain/core langchain chalk
````

## Start the agent script

Create a `main.ts` script, and import all the packages and libraries. Imports from 
the `"./tools"` package may give errors in your IDE now, but don't worry about those
for now, you will write that helper package later.

````typescript
"use strict";
import { getTools, confirm, arcade } from "./tools";
import { createAgent } from "langchain";
import {
  Command,
  MemorySaver,
  type Interrupt,
} from "@langchain/langgraph";
import chalk from "chalk";
import * as readline from "node:readline/promises";
````

## Configuration

In `main.ts`, configure your agent's toolkits, system prompt, and model. Notice
how the system prompt tells the agent how to navigate different scenarios and
how to combine tool usage in specific ways. This prompt engineering is important
to build effective agents. In fact, the more agentic your application, the more
relevant the system prompt to truly make the agent useful and effective at
using the tools at its disposal.

````typescript
// configure your own values to customize your agent

// The Arcade User ID identifies who is authorizing each service.
const arcadeUserID = process.env.ARCADE_USER_ID;
if (!arcadeUserID) {
  throw new Error("Missing ARCADE_USER_ID. Add it to your .env file.");
}
// This determines which MCP server is providing the tools, you can customize this to make a Slack agent, or Notion agent, etc.
// all tools from each of these MCP servers will be retrieved from arcade
const toolkits=['Salesforce'];
// This determines isolated tools that will be
const isolatedTools=[];
// This determines the maximum number of tool definitions Arcade will return
const toolLimit = 100;
// This prompt defines the behavior of the agent.
const systemPrompt = "# Salesforce ReAct Agent \u2014 Prompt\n\n## Introduction\nYou are a ReAct-style AI agent that helps users interact with Salesforce. Your primary actions are:\n- Search for accounts and retrieve account details (contacts, leads, notes, calls, opportunities, tasks, emails, events).\n- Create contacts under a specified account.\n\nYou must use the provided tools to perform any Salesforce reads or writes:\n- Salesforce_GetAccountDataById\n- Salesforce_GetAccountDataByKeywords\n- Salesforce_CreateContact\n\nWork in a ReAct loop: think, decide on an action (tool call), call the tool, observe the tool output, and continue reasoning until you can give a final answer or ask the user for clarification.\n\n---\n\n## Instructions (How you should operate)\n1. ReAct style:\n   - Always explicitly separate your internal reasoning (\"Thought\") from actions (\"Action\") and observations (\"Observation\") when interacting with tools.\n   - Use the available tools for all Salesforce reads/writes. Do not fabricate Salesforce data.\n   - After each tool call, incorporate the returned observation into your next Thought.\n\n2. When to call which tool:\n   - If the user gives an account ID \u2192 call Salesforce_GetAccountDataById(account_id=...).\n   - If the user gives an account name or other keywords \u2192 call Salesforce_GetAccountDataByKeywords(query=..., limit=N).\n     - Query must be longer than one character.\n     - Limit defaults to 10; you may set limit to \u226410 (often use 5\u201310 for user choice).\n   - To add a contact \u2192 call Salesforce_CreateContact with the required fields:\n     - Required parameters: account_id (string) and last_name (string).\n     - Optional parameters: first_name, email, phone, mobile_phone, title, department, description.\n\n3. Validate inputs before tool calls:\n   - Ensure account_id is provided and is non-empty for Salesforce_GetAccountDataById / CreateContact.\n   - Ensure the search query is \u003e1 character.\n   - For create contact, if last_name is missing, ask the user for it before calling the tool.\n   - If phone/email provided, lightly validate format (email contains \u201c@\u201d, phone digits) and ask for confirmation if obviously invalid.\n\n4. Handle ambiguity and multiple results:\n   - If a keyword search returns:\n     - 0 results \u2192 inform the user and ask for a better query or an account ID.\n     - 1 result \u2192 proceed with that account (state which account was found).\n     - \u003e1 results \u2192 present a concise list (name + account_id + one-line context, e.g., website or phone) and ask the user to pick an account_id or name to continue.\n   - When presenting multiple options, show at most 5 items unless the user asks for more.\n\n5. Confirm destructive or write actions:\n   - Before creating a contact, summarize the contact fields you will create and ask the user to confirm if any important fields are missing or if they want to proceed.\n   - If the user explicitly asks you to create without confirmation, proceed.\n\n6. Error handling:\n   - If a tool returns an error or unexpected result, report the exact error text to the user and propose next steps (retry, clarify query, or provide account_id).\n   - If the returned account payload appears incomplete, ask the user if they want to try a different query or increase the search limit/page.\n\n7. Output style:\n   - Keep user-facing messages concise and actionable.\n   - When presenting results, include key fields (account name, account_id, contacts count) and any immediate options.\n   - After creating a contact, present the resulting contact summary from the tool output and next steps (e.g., \"Would you like to create another contact or add details?\").\n\n---\n\n## Workflows\nBelow are common workflows and the exact sequence of tools and checks to follow. Use the ReAct pattern (Thought \u2192 Action(tool) \u2192 Observation \u2192 Thought \u2192 ...).\n\nWorkflow A \u2014 \"Find account by ID and show details\"\n1. Precondition: user provides account_id.\n2. Action sequence:\n   - Call Salesforce_GetAccountDataById(account_id=USER_PROVIDED_ID)\n3. Post-call:\n   - If found \u2192 present account summary and related items (up to 10 per type).\n   - If not found or error \u2192 report and ask for correct ID or different query.\n\nExample:\n```\nThought: User gave an account_id; I should fetch the account details.\nAction: Salesforce_GetAccountDataById\nparameters: { \"account_id\": \"001ABC...\" }\nObservation: \u003ctool output\u003e\nThought: Found account with name X and 3 contacts; present summary and ask next steps.\n```\n\nWorkflow B \u2014 \"Search accounts by keywords\"\n1. Precondition: user provides keywords (name, domain, phone, etc.).\n2. Action sequence:\n   - Call Salesforce_GetAccountDataByKeywords(query=USER_QUERY, limit=5)\n     - Choose limit=5 by default to keep options manageable.\n3. Post-call:\n   - 0 results \u2192 ask user to refine the query.\n   - 1 result \u2192 show full account summary (you may optionally call GetAccountDataById if extra detail needed, but the keyword tool returns related info already).\n   - \u003e1 results \u2192 display a short list (name + account_id + helpful context) and ask the user to pick one (or provide an account_id).\n\nExample:\n```\nThought: User asked for \"Acme\" results; call keyword search.\nAction: Salesforce_GetAccountDataByKeywords\nparameters: { \"query\": \"Acme\", \"limit\": 5 }\nObservation: \u003ctool output: list of accounts\u003e\nThought: There are 3 matches; present compact list and ask which account the user wants.\n```\n\nWorkflow C \u2014 \"Create a contact for a known account_id\"\n1. Precondition: user provides account_id and at least last_name OR you confirm missing required fields with the user.\n2. Action sequence:\n   - Optionally: call Salesforce_GetAccountDataById(account_id=...) to confirm account exists and show context.\n   - Ask for any missing required contact fields (last_name) and confirm optional fields if helpful.\n   - After confirmation, call Salesforce_CreateContact(account_id=..., last_name=..., first_name=..., email=..., phone=..., mobile_phone=..., title=..., department=..., description=...)\n3. Post-call:\n   - On success \u2192 present created contact summary from the tool output (ID, name, email, phone, account).\n   - On error \u2192 show the error and propose next steps.\n\nExample:\n```\nThought: I\u0027ll verify the account then create the contact.\nAction: Salesforce_GetAccountDataById\nparameters: { \"account_id\": \"001ABC...\" }\nObservation: \u003caccount exists\u003e\nThought: Ask user to confirm contact details (last_name required).\n[User confirms]\nAction: Salesforce_CreateContact\nparameters: {\n  \"account_id\": \"001ABC...\",\n  \"last_name\": \"Smith\",\n  \"first_name\": \"Jane\",\n  \"email\": \"jane.smith@example.com\",\n  \"phone\": \"555-1234\",\n  \"title\": \"VP Sales\"\n}\nObservation: \u003ctool output: contact created\u003e\nThought: Inform the user of success and next steps.\n```\n\nWorkflow D \u2014 \"Create a contact but user provided only account name (not ID)\"\n1. Action sequence:\n   - Call Salesforce_GetAccountDataByKeywords(query=account_name, limit=5).\n   - If a single account is identified, proceed with Workflow C.\n   - If multiple, ask user to select account_id or provide more details.\n   - If none, ask for an account_id or clearer keywords.\n\nWorkflow E \u2014 \"Quick account inspection\"\n1. If user asks for a brief view (contacts or opportunities) and supplies keywords or ID:\n   - Use the appropriate Get tool to fetch relevant related records (the tools return up to 10 of each related type).\n   - Present a short summary of the requested related items (top 5 by recency or amount where applicable).\n\n---\n\n## Example ReAct Conversation Patterns\n\n- Search example:\n```\nThought: Need to find accounts matching \"Acme Corp\".\nAction: Salesforce_GetAccountDataByKeywords\nparameters: { \"query\": \"Acme Corp\", \"limit\": 5 }\nObservation: \u003ctool returns 3 accounts\u003e\nThought: Present the three accounts with names and account_id and ask which one to use.\n```\n\n- Create contact example (user provided account_id and contact details):\n```\nThought: User provided account_id and last_name; create contact.\nAction: Salesforce_CreateContact\nparameters: {\n  \"account_id\": \"001ABC\",\n  \"last_name\": \"Garcia\",\n  \"first_name\": \"Luis\",\n  \"email\": \"luis.garcia@example.com\",\n  \"phone\": \"+1-555-987-1234\",\n  \"title\": \"CTO\",\n  \"department\": \"Engineering\"\n}\nObservation: \u003ctool returns contact created with id 003XYZ and details\u003e\nThought: Confirm success to user and show created contact summary.\n```\n\n---\n\n## Additional guidance and best practices\n- Minimize calls: avoid unnecessary Get calls if the user already supplied sufficient data (e.g., account_id present).\n- Respect limits: Keyword search max limit is 10; prefer limit=5 for choice lists.\n- Always surface helpful context from tool outputs (account name, id, number of contacts, key opportunities).\n- Be explicit about what you will do (and ask for confirmation) before creating contacts, especially if key fields are missing.\n- When asking follow-up questions, be concise and ask for only the missing or ambiguous piece(s) of information.\n\n---\n\nUse this prompt as the agent\u0027s operating instructions. Follow the ReAct pattern closely: think, act (call tool), observe, and repeat until you can give a clear, concise final answer or a simple clarifying question to the user.";
// This determines which LLM will be used inside the agent
const agentModel = process.env.OPENAI_MODEL;
if (!agentModel) {
  throw new Error("Missing OPENAI_MODEL. Add it to your .env file.");
}
// This allows LangChain to retain the context of the session
const threadID = "1";
````

Set the following environment variables in a `.env` file:

````bash
ARCADE_API_KEY=your-arcade-api-key
ARCADE_USER_ID=your-arcade-user-id
OPENAI_API_KEY=your-openai-api-key
OPENAI_MODEL=gpt-5-mini
````

## Implementing the `tools.ts` module

The `tools.ts` module fetches Arcade tool definitions and converts them to LangChain-compatible tools using Arcade's Zod schema conversion:

### Create the file and import the dependencies

Create a `tools.ts` file, and add import the following. These will allow you to build the helper functions needed to convert Arcade tool definitions into a format that LangChain can execute. Here, you also define which tools will require human-in-the-loop confirmation. This is very useful for tools that may have dangerous or undesired side-effects if the LLM hallucinates the values in the parameters. You will implement the helper functions to require human approval in this module.

````typescript
import { Arcade } from "@arcadeai/arcadejs";
import {
  type ToolExecuteFunctionFactoryInput,
  type ZodTool,
  executeZodTool,
  isAuthorizationRequiredError,
  toZod,
} from "@arcadeai/arcadejs/lib/index";
import { type ToolExecuteFunction } from "@arcadeai/arcadejs/lib/zod/types";
import { tool } from "langchain";
import {
  interrupt,
} from "@langchain/langgraph";
import readline from "node:readline/promises";

// This determines which tools require human in the loop approval to run
const TOOLS_WITH_APPROVAL = ['Salesforce_CreateContact'];
````

### Create a confirmation helper for human in the loop

The first helper that you will write is the `confirm` function, which asks a yes or no question to the user, and returns `true` if theuser replied with `"yes"` and `false` otherwise.

````typescript
// Prompt user for yes/no confirmation
export async function confirm(question: string, rl?: readline.Interface): Promise<boolean> {
  let shouldClose = false;
  let interface_ = rl;

  if (!interface_) {
      interface_ = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
      });
      shouldClose = true;
  }

  const answer = await interface_.question(`${question} (y/n): `);

  if (shouldClose) {
      interface_.close();
  }

  return ["y", "yes"].includes(answer.trim().toLowerCase());
}
````

Tools that require authorization trigger a LangGraph interrupt, which pauses execution until the user completes authorization in their browser.

### Create the execution helper

This is a wrapper around the `executeZodTool` function. Before you execute the tool, however, there are two logical checks to be made:

1. First, if the tool the agent wants to invoke is included in the `TOOLS_WITH_APPROVAL` variable, human-in-the-loop is enforced by calling `interrupt` and passing the necessary data to call the `confirm` helper. LangChain will surface that `interrupt` to the agentic loop, and you will be required to "resolve" the interrupt later on. For now, you can assume that the reponse of the `interrupt` will have enough information to decide whether to execute the tool or not, depending on the human's reponse.
2. Second, if the tool was approved by the human, but it doesn't have the authorization of the integration to run, then you need to present an URL to the user so they can authorize the OAuth flow for this operation. For this, an execution is attempted, that may fail to run if the user is not authorized. When it fails, you interrupt the flow and send the authorization request for the harness to handle. If the user authorizes the tool, the harness will reply with an `{authorized: true}` object, and the system will retry the tool call without interrupting the flow.

````typescript
export function executeOrInterruptTool({
  zodToolSchema,
  toolDefinition,
  client,
  userId,
}: ToolExecuteFunctionFactoryInput): ToolExecuteFunction<any> {
  const { name: toolName } = zodToolSchema;

  return async (input: unknown) => {
    try {

      // If the tool is on the list that enforces human in the loop, we interrupt the flow and ask the user to authorize the tool

      if (TOOLS_WITH_APPROVAL.includes(toolName)) {
        const hitl_response = interrupt({
          authorization_required: false,
          hitl_required: true,
          tool_name: toolName,
          input: input,
        });

        if (!hitl_response.authorized) {
          // If the user didn't approve the tool call, we throw an error, which will be handled by LangChain
          throw new Error(
            `Human in the loop required for tool call ${toolName}, but user didn't approve.`
          );
        }
      }

      // Try to execute the tool
      const result = await executeZodTool({
        zodToolSchema,
        toolDefinition,
        client,
        userId,
      })(input);
      return result;
    } catch (error) {
      // If the tool requires authorization, we interrupt the flow and ask the user to authorize the tool
      if (error instanceof Error && isAuthorizationRequiredError(error)) {
        const response = await client.tools.authorize({
          tool_name: toolName,
          user_id: userId,
        });

        // We interrupt the flow here, and pass everything the handler needs to get the user's authorization
        const interrupt_response = interrupt({
          authorization_required: true,
          authorization_response: response,
          tool_name: toolName,
          url: response.url ?? "",
        });

        // If the user authorized the tool, we retry the tool call without interrupting the flow
        if (interrupt_response.authorized) {
          const result = await executeZodTool({
            zodToolSchema,
            toolDefinition,
            client,
            userId,
          })(input);
          return result;
        } else {
          // If the user didn't authorize the tool, we throw an error, which will be handled by LangChain
          throw new Error(
            `Authorization required for tool call ${toolName}, but user didn't authorize.`
          );
        }
      }
      throw error;
    }
  };
}
````

### Create the tool retrieval helper

The last helper function of this module is the `getTools` helper. This function will take the configurations you defined in the `main.ts` file, and retrieve all of the configured tool definitions from Arcade. Those definitions will then be converted to LangGraph `Function` tools, and will be returned in a format that LangChain can present to the LLM so it can use the tools and pass the arguments correctly. You will pass the `executeOrInterruptTool` helper you wrote in the previous section so all the bindings to the human-in-the-loop and auth handling are programmed when LancChain invokes a tool.


````typescript
// Initialize the Arcade client
export const arcade = new Arcade();

export type GetToolsProps = {
  arcade: Arcade;
  toolkits?: string[];
  tools?: string[];
  userId: string;
  limit?: number;
}


export async function getTools({
  arcade,
  toolkits = [],
  tools = [],
  userId,
  limit = 100,
}: GetToolsProps) {

  if (toolkits.length === 0 && tools.length === 0) {
      throw new Error("At least one tool or toolkit must be provided");
  }

  // Todo(Mateo): Add pagination support
  const from_toolkits = await Promise.all(toolkits.map(async (tkitName) => {
      const definitions = await arcade.tools.list({
          toolkit: tkitName,
          limit: limit
      });
      return definitions.items;
  }));

  const from_tools = await Promise.all(tools.map(async (toolName) => {
      return await arcade.tools.get(toolName);
  }));

  const all_tools = [...from_toolkits.flat(), ...from_tools];
  const unique_tools = Array.from(
      new Map(all_tools.map(tool => [tool.qualified_name, tool])).values()
  );

  const arcadeTools = toZod({
    tools: unique_tools,
    client: arcade,
    executeFactory: executeOrInterruptTool,
    userId: userId,
  });

  // Convert Arcade tools to LangGraph tools
  const langchainTools = arcadeTools.map(({ name, description, execute, parameters }) =>
    (tool as Function)(execute, {
      name,
      description,
      schema: parameters,
    })
  );

  return langchainTools;
}
````

## Building the Agent

Back on the `main.ts` file, you can now call the helper functions you wrote to build the agent.

### Retrieve the configured tools

Use the `getTools` helper you wrote to retrieve the tools from Arcade in LangChain format:

````typescript
const tools = await getTools({
  arcade,
  toolkits: toolkits,
  tools: isolatedTools,
  userId: arcadeUserID,
  limit: toolLimit,
});
````

### Write an interrupt handler

When LangChain is interrupted, it will emit an event in the stream that you will need to handle and resolve based on the user's behavior. For a human-in-the-loop interrupt, you will call the `confirm` helper you wrote earlier, and indicate to the harness whether the human approved the specific tool call or not. For an auth interrupt, you will present the OAuth URL to the user, and wait for them to finishe the OAuth dance before resolving the interrupt with `{authorized: true}` or `{authorized: false}` if an error occurred:

````typescript
async function handleInterrupt(
  interrupt: Interrupt,
  rl: readline.Interface
): Promise<{ authorized: boolean }> {
  const value = interrupt.value;
  const authorization_required = value.authorization_required;
  const hitl_required = value.hitl_required;
  if (authorization_required) {
    const tool_name = value.tool_name;
    const authorization_response = value.authorization_response;
    console.log("⚙️: Authorization required for tool call", tool_name);
    console.log(
      "⚙️: Please authorize in your browser",
      authorization_response.url
    );
    console.log("⚙️: Waiting for you to complete authorization...");
    try {
      await arcade.auth.waitForCompletion(authorization_response.id);
      console.log("⚙️: Authorization granted. Resuming execution...");
      return { authorized: true };
    } catch (error) {
      console.error("⚙️: Error waiting for authorization to complete:", error);
      return { authorized: false };
    }
  } else if (hitl_required) {
    console.log("⚙️: Human in the loop required for tool call", value.tool_name);
    console.log("⚙️: Please approve the tool call", value.input);
    const approved = await confirm("Do you approve this tool call?", rl);
    return { authorized: approved };
  }
  return { authorized: false };
}
````

### Create an Agent instance

Here you create the agent using the `createAgent` function. You pass the system prompt, the model, the tools, and the checkpointer. When the agent runs, it will automatically use the helper function you wrote earlier to handle tool calls and authorization requests.

````typescript
const agent = createAgent({
  systemPrompt: systemPrompt,
  model: agentModel,
  tools: tools,
  checkpointer: new MemorySaver(),
});
````

### Write the invoke helper

This last helper function handles the streaming of the agent’s response, and captures the interrupts. When the system detects an interrupt, it adds the interrupt to the `interrupts` array, and the flow interrupts. If there are no interrupts, it will just stream the agent’s to your console.

````typescript
async function streamAgent(
  agent: any,
  input: any,
  config: any
): Promise<Interrupt[]> {
  const stream = await agent.stream(input, {
    ...config,
    streamMode: "updates",
  });
  const interrupts: Interrupt[] = [];

  for await (const chunk of stream) {
    if (chunk.__interrupt__) {
      interrupts.push(...(chunk.__interrupt__ as Interrupt[]));
      continue;
    }
    for (const update of Object.values(chunk)) {
      for (const msg of (update as any)?.messages ?? []) {
        console.log("🤖: ", msg.toFormattedString());
      }
    }
  }

  return interrupts;
}
````

### Write the main function

Finally, write the main function that will call the agent and handle the user input.

Here the `config` object configures the `thread_id`, which tells the agent to store the state of the conversation into that specific thread. Like any typical agent loop, you:

1. Capture the user input
2. Stream the agent's response
3. Handle any authorization interrupts
4. Resume the agent after authorization
5. Handle any errors
6. Exit the loop if the user wants to quit

````typescript
async function main() {
  const config = { configurable: { thread_id: threadID } };
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log(chalk.green("Welcome to the chatbot! Type 'exit' to quit."));
  while (true) {
    const input = await rl.question("> ");
    if (input.toLowerCase() === "exit") {
      break;
    }
    rl.pause();

    try {
      let agentInput: any = {
        messages: [{ role: "user", content: input }],
      };

      // Loop until no more interrupts
      while (true) {
        const interrupts = await streamAgent(agent, agentInput, config);

        if (interrupts.length === 0) {
          break; // No more interrupts, we're done
        }

        // Handle all interrupts
        const decisions: any[] = [];
        for (const interrupt of interrupts) {
          decisions.push(await handleInterrupt(interrupt, rl));
        }

        // Resume with decisions, then loop to check for more interrupts
        // Pass single decision directly, or array for multiple interrupts
        agentInput = new Command({ resume: decisions.length === 1 ? decisions[0] : decisions });
      }
    } catch (error) {
      console.error(error);
    }

    rl.resume();
  }
  console.log(chalk.red("👋 Bye..."));
  process.exit(0);
}

// Run the main function
main().catch((err) => console.error(err));
````

## Running the Agent

### Run the agent

```bash
bun run main.ts
```

You should see the agent responding to your prompts like any model, as well as handling any tool calls and authorization requests.

## Next Steps

- Clone the [repository](https://github.com/arcade-agents/ts-langchain-Salesforce) and run it
- Add more toolkits to the `toolkits` array to expand capabilities
- Customize the `systemPrompt` to specialize the agent's behavior
- Explore the [Arcade documentation](https://docs.arcade.dev) for available toolkits

