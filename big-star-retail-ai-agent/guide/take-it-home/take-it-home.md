# Lab 13: Take it home

## Introduction

This lab shows how to run the Big Star demo in your own environment using the portable stack package and Podman Compose.

Estimated Time: 30 minutes

### Objectives

In this lab, you will:
- Download the portable demo package.
- Extract and prepare the local environment file.
- Start the full application stack with Podman Compose.
- Validate the app and stop the stack cleanly.

## Task 1: Download the portable package

1. Download the package from:
    `https://<ADD-DOWNLOAD-URL-HERE>/ll-demo-agent.zip`
2. Save the file to a local working directory.

Expected result:
- You have `ll-demo-agent.zip` available on your machine.

## Task 2: Extract and prepare environment settings

1. Extract the package:
    ```bash
    unzip ll-demo-agent.zip -d big-star-demo
    ```
2. Move into the extracted folder:
    ```bash
    cd big-star-demo
    ```
3. Create your runtime environment file:
    ```bash
    cp .env.example .env
    ```

Expected result:
- The folder contains `compose.yaml`, `.env`, and all required app files.

## Task 3: Start the demo with Podman Compose

1. Start all services:
    ```bash
    podman compose up -d
    ```
2. Check service status:
    ```bash
    podman compose ps
    ```
3. Verify application health:
    ```bash
    curl http://localhost:5500/api/health
    ```
4. Open the demo in a browser:
    `http://localhost:5500`

Expected result:
- Database, ORDS, Ollama, and app services start successfully.
- Health check returns `status: ok`.
- The Big Star UI loads locally.

## Task 4: Stop the stack when finished

1. Stop and remove running containers:
    ```bash
    podman compose down
    ```

Expected result:
- The local demo stack is stopped cleanly.

## Task 5: Why this matters?

A portable runbook is what turns a demo into a repeatable field asset. By packaging the application and startup flow into a Podman Compose stack, teams can reproduce the same scenario in customer-adjacent environments with less setup drift and fewer handoffs. This makes it easier to validate value quickly, support workshops consistently, and move from guided demo sessions to practical self-service enablement.

## Acknowledgements

- **Author** - LiveLabs Team
- **Last Updated By/Date** - LiveLabs Team, March 2026
