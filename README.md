# An agent that uses Salesforce tools provided to perform any task

## Purpose

# Introduction
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

By following these workflows, the Salesforce AI Agent will be equipped to assist users efficiently in managing their accounts and contacts.

## MCP Servers

The agent uses tools from these Arcade MCP Servers:

- Salesforce

## Human-in-the-Loop Confirmation

The following tools require human confirmation before execution:

- `Salesforce_CreateContact`


## Getting Started

1. Install dependencies:
    ```bash
    bun install
    ```

2. Set your environment variables:

    Copy the `.env.example` file to create a new `.env` file, and fill in the environment variables.
    ```bash
    cp .env.example .env
    ```

3. Run the agent:
    ```bash
    bun run main.ts
    ```