from agents import (Agent, Runner, AgentHooks, Tool, RunContextWrapper,
                    TResponseInputItem,)
from functools import partial
from arcadepy import AsyncArcade
from agents_arcade import get_arcade_tools
from typing import Any
from human_in_the_loop import (UserDeniedToolCall,
                               confirm_tool_usage,
                               auth_tool)

import globals


class CustomAgentHooks(AgentHooks):
    def __init__(self, display_name: str):
        self.event_counter = 0
        self.display_name = display_name

    async def on_start(self,
                       context: RunContextWrapper,
                       agent: Agent) -> None:
        self.event_counter += 1
        print(f"### ({self.display_name}) {
              self.event_counter}: Agent {agent.name} started")

    async def on_end(self,
                     context: RunContextWrapper,
                     agent: Agent,
                     output: Any) -> None:
        self.event_counter += 1
        print(
            f"### ({self.display_name}) {self.event_counter}: Agent {
                # agent.name} ended with output {output}"
                agent.name} ended"
        )

    async def on_handoff(self,
                         context: RunContextWrapper,
                         agent: Agent,
                         source: Agent) -> None:
        self.event_counter += 1
        print(
            f"### ({self.display_name}) {self.event_counter}: Agent {
                source.name} handed off to {agent.name}"
        )

    async def on_tool_start(self,
                            context: RunContextWrapper,
                            agent: Agent,
                            tool: Tool) -> None:
        self.event_counter += 1
        print(
            f"### ({self.display_name}) {self.event_counter}:"
            f" Agent {agent.name} started tool {tool.name}"
            f" with context: {context.context}"
        )

    async def on_tool_end(self,
                          context: RunContextWrapper,
                          agent: Agent,
                          tool: Tool,
                          result: str) -> None:
        self.event_counter += 1
        print(
            f"### ({self.display_name}) {self.event_counter}: Agent {
                # agent.name} ended tool {tool.name} with result {result}"
                agent.name} ended tool {tool.name}"
        )


async def main():

    context = {
        "user_id": os.getenv("ARCADE_USER_ID"),
    }

    client = AsyncArcade()

    arcade_tools = await get_arcade_tools(
        client, toolkits=["Salesforce"]
    )

    for tool in arcade_tools:
        # - human in the loop
        if tool.name in ENFORCE_HUMAN_CONFIRMATION:
            tool.on_invoke_tool = partial(
                confirm_tool_usage,
                tool_name=tool.name,
                callback=tool.on_invoke_tool,
            )
        # - auth
        await auth_tool(client, tool.name, user_id=context["user_id"])

    agent = Agent(
        name="",
        instructions="# Introduction
Welcome to the Salesforce AI Agent! This intelligent assistant is designed to help you manage Salesforce accounts and contacts effortlessly. With the ability to create contacts and fetch account information based on keywords or specific IDs, this agent simplifies your workflow and enhances productivity.

# Instructions
The agent will perform operations in Salesforce by using a combination of the tools available. The agent will respond to user queries by gathering necessary information, executing the appropriate tools, and providing clear feedback. When searching for accounts or creating contacts, ensure to provide all required parameters.

# Workflows

## Workflow 1: Search for Accounts by Keywords
1. **User Input:** Receive a query from the user to search for accounts.
2. **Tool Used:** `Salesforce_GetAccountDataByKeywords`
   - **Parameters:** 
     - `query` (required): the search term provided by the user.
     - `limit` (optional): set a maximum number of accounts to return (default to 10).
     - `page` (optional): the page number of the results to return (default to 1).
3. **Output:** Return the list of matching accounts along with their related data (contacts, leads, etc.).

## Workflow 2: Get Account Data by ID
1. **User Input:** Receive an account ID from the user to fetch detailed information.
2. **Tool Used:** `Salesforce_GetAccountDataById`
   - **Parameters:**
     - `account_id` (required): the ID of the account to retrieve.
3. **Output:** Return comprehensive details about the specified account, including related contacts, leads, and opportunities.

## Workflow 3: Create a Contact for an Account
1. **User Input:** Gather required data from the user to create a new contact (e.g., account ID, last name, and optional fields like first name, email, phone, etc.).
2. **Tool Used:** `Salesforce_CreateContact`
   - **Parameters:**
     - `account_id` (required): the ID of the account for which the contact is to be created.
     - `last_name` (required): last name of the contact.
     - Other optional fields like `first_name`, `email`, `phone`, `mobile_phone`, `title`, `department`, and `description` can also be included based on user input.
3. **Output:** Provide confirmation of the contact creation along with the new contact’s details.

By following these workflows, the Salesforce AI Agent will be equipped to assist users efficiently in managing their accounts and contacts.",
        model=os.environ["OPENAI_MODEL"],
        tools=arcade_tools,
        hooks=CustomAgentHooks(display_name="")
    )

    # initialize the conversation
    history: list[TResponseInputItem] = []
    # run the loop!
    while True:
        prompt = input("You: ")
        if prompt.lower() == "exit":
            break
        history.append({"role": "user", "content": prompt})
        try:
            result = await Runner.run(
                starting_agent=agent,
                input=history,
                context=context
            )
            history = result.to_input_list()
            print(result.final_output)
        except UserDeniedToolCall as e:
            history.extend([
                {"role": "assistant",
                 "content": f"Please confirm the call to {e.tool_name}"},
                {"role": "user",
                 "content": "I changed my mind, please don't do it!"},
                {"role": "assistant",
                 "content": f"Sure, I cancelled the call to {e.tool_name}."
                 " What else can I do for you today?"
                 },
            ])
            print(history[-1]["content"])

if __name__ == "__main__":
    import asyncio

    asyncio.run(main())