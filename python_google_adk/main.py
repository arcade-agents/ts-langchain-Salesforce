from arcadepy import AsyncArcade
from dotenv import load_dotenv
from google.adk import Agent, Runner
from google.adk.artifacts import InMemoryArtifactService
from google.adk.models.lite_llm import LiteLlm
from google.adk.sessions import InMemorySessionService, Session
from google_adk_arcade.tools import get_arcade_tools
from google.genai import types
from human_in_the_loop import auth_tool, confirm_tool_usage

import os

load_dotenv(override=True)


async def main():
    app_name = "my_agent"
    user_id = os.getenv("ARCADE_USER_ID")

    session_service = InMemorySessionService()
    artifact_service = InMemoryArtifactService()
    client = AsyncArcade()

    agent_tools = await get_arcade_tools(
        client, toolkits=["Salesforce"]
    )

    for tool in agent_tools:
        await auth_tool(client, tool_name=tool.name, user_id=user_id)

    agent = Agent(
        model=LiteLlm(model=f"openai/{os.environ["OPENAI_MODEL"]}"),
        name="google_agent",
        instruction="# Introduction
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
        description="An agent that uses Salesforce tools provided to perform any task",
        tools=agent_tools,
        before_tool_callback=[confirm_tool_usage],
    )

    session = await session_service.create_session(
        app_name=app_name, user_id=user_id, state={
            "user_id": user_id,
        }
    )
    runner = Runner(
        app_name=app_name,
        agent=agent,
        artifact_service=artifact_service,
        session_service=session_service,
    )

    async def run_prompt(session: Session, new_message: str):
        content = types.Content(
            role='user', parts=[types.Part.from_text(text=new_message)]
        )
        async for event in runner.run_async(
            user_id=user_id,
            session_id=session.id,
            new_message=content,
        ):
            if event.content.parts and event.content.parts[0].text:
                print(f'** {event.author}: {event.content.parts[0].text}')

    while True:
        user_input = input("User: ")
        if user_input.lower() == "exit":
            print("Goodbye!")
            break
        await run_prompt(session, user_input)


if __name__ == '__main__':
    import asyncio
    asyncio.run(main())