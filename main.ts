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

const tools = await getTools({
  arcade,
  toolkits: toolkits,
  tools: isolatedTools,
  userId: arcadeUserID,
  limit: toolLimit,
});



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

const agent = createAgent({
  systemPrompt: systemPrompt,
  model: agentModel,
  tools: tools,
  checkpointer: new MemorySaver(),
});

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