# OPNet Node Plugins

> **Status:** _DRAFT v0.1.0 – April 29 2025_

This proposal goal is to provide a comprehensive overview of the OPNet Node Plugin system, including how to install,
develop, and publish plugins. The OPNet Node Plugin system allows developers to extend the functionality of OPNet nodes
by creating custom plugins that can be easily installed and utilized as third-party modules.

---

## Table of Contents

1. [Overview](#overview)
2. [Key Features](#key-features)
3. [Installing a Plugin](#installing-a-plugin)
4. [Developing a Plugin](#developing-a-plugin)
    - [Plugin Lifecycle Hooks](#plugin-lifecycle-hooks)
    - [Threading and Background Tasks](#threading-and-background-tasks)
    - [Configuration & Plugin Settings](#configuration--plugin-settings)
5. [Example Plugin: MyFunPlugin](#example-plugin-myfunplugin)
6. [Publishing Your Plugin](#publishing-your-plugin)

---

## Overview

**OPNet Node Plugins** enable developers to easily add or modify features within an OPNet node. This eliminates the need
to implement from scratch complicated block ingestion, transaction parsing, or consistent state management.

### Why Plugins?

- **Modular Development**: Each plugin is self-contained with its own hooks, configuration, and optional background
  threads.
- **Simplified Block Management**: Use built-in hooks for pre-/post-block processing, mempool access, or any other
  event-based data.
- **Custom APIs**: Extend the node's HTTP endpoints with minimal effort.
- **Database Integration**: Access the node's database to store or retrieve plugin-specific data.
- **Threading**: Offload intensive tasks to background threads to keep the main node loop running smoothly.

---

## Key Features

1. **Pre/Post Block Hooks**  
   Plugins can intercept blocks before and after they are processed by the node, enabling custom logic or
   transformations.

2. **Witness and Mempool Access**  
   Monitor and act on witness data or mempool transactions in real time.

3. **Custom API Endpoints**  
   Expose additional HTTP routes (e.g., `/plugins/myfunplugin/routes`) to interact with your plugin's data or logic.

4. **Database Integration**  
   Access OPNet's internal database or set up plugin-specific tables, letting you store relevant data without building a
   new storage layer from scratch.

5. **Threading Support**  
   Use background threads to offload heavy computation or keep track of asynchronous tasks without blocking the node's
   main loop.

6. **Easy Installation**  
   Simply run `opnet plugin install <plugin-name>` to install a plugin from a public or private registry. Configuration
   is automatically loaded from a JSON file.

---

## Installing a Plugin

Installing an existing plugin is as easy as running:

```bash
opnet plugin install PLUGIN_NAME
```

This will:

- Download the specified plugin package from the default plugin registry (or a configured registry).
- Install it into your node's plugin directory.
- Load any necessary plugin configuration (e.g., pluginSettings.json).
- Automatically register the plugin's routes, hooks, and background threads into your existing node.

---

## Developing a Plugin

### Plugin Lifecycle Hooks

Plugins can listen to various hooks to integrate with different stages of the node's workflow:

1. **`onPreBlockProcessing(rawBlockData)`**
    - Invoked **before** the node processes the raw block data and transactions.
    - Ideal for custom transformations or early filtering.

2. **`onPostBlockProcessing(decodedBlock)`**
    - Called **after** the node has decoded and processed the block transactions.
    - Perfect for indexing or analytics that depend on fully decoded data.

3. **`onMempoolUpdate(transactionInfo)`**
    - Triggered when new transactions enter the mempool.
    - Use this to monitor or filter pending transactions.

4. **`onWitnessData(witnessInfo)`**
    - Fires whenever the node receives new witness data.
    - Great for protocol-level analytics or advanced consensus monitoring.

5. **`onPluginStart()`**
    - Called when the plugin is loaded and ready to start processing.
    - Use this to initialize any resources or start background tasks.
    - **Note**: This is not a lifecycle hook but a good place to start threads or initialize data.

6. **`onPluginStop()`**
    - Invoked when the plugin is being unloaded or stopped.
    - Use this to clean up resources, close database connections, or stop background tasks.

7. **`onPluginError(error)`**
    - Called when an error occurs within the plugin.
    - Use this to log errors or handle exceptions gracefully.

8. **`onPluginConfigChange(newConfig)`**
    - Invoked when the plugin's configuration changes.
    - Use this to update internal settings or restart background tasks.

9. **`onPluginMessage(message)`**
    - Called when the plugin receives a message from another plugin or the main node.
    - Use this to handle inter-plugin communication or respond to requests.

10. **`onPluginRouteRequest(req, res)`**
    - Invoked when a request is made to the plugin's custom route.
    - Use this to handle HTTP requests and send responses.

11. **`onPluginRouteError(error)`**
    - Called when an error occurs while processing a request to the plugin's custom route.
    - Use this to log errors or send error responses.

... and more

### Threading and Background Tasks

For plugins that require continuous or heavy processing, you can offload tasks to a background thread. This keeps the
main node process responsive.

- **`this.postToThread(data: any)`**  
  Send messages or data from your main plugin to the worker thread.

- **`async onThreadMessage(data: any)`**  
  Receive and handle responses from the worker thread asynchronously.

### Configuration & Plugin Settings

Each plugin can have a `plugin.json` file that includes essential information:

```json
{
    "name": "my-fun-plugin",
    "version": "1.0.0",
    "description": "A fun OPNet plugin.",
    "threadConfig": {
        "enabled": true,
        "maxWorkers": 2,
        "priority": "normal"
    },
    "pluginDependencies": {
        "some-other-plugins": "^2.1.3"
    },
    "dependencies": {
        "some-npm-package": "^1.0.0"
    }
}
```

---

## Example Plugin: MyFunPlugin

Below is a small TypeScript mock showing how to structure a plugin. This example demonstrates some typical hooks and how
to post messages to an internal thread.

```ts
import { OPNetPlugin, BlockData, DecodedBlock, MempoolTx, WitnessData } from 'opnet';

export class MyFunPlugin extends OPNetPlugin {
    constructor() {
        super();
    }

    // Called before block processing
    protected async onPreBlockProcessing(rawBlockData: BlockData): Promise<void> {
        this.log('[MyFunPlugin] Pre-block processing:', rawBlockData.blockHash);
    }

    // Called after block processing
    protected async onPostBlockProcessing(decodedBlock: DecodedBlock): Promise<void> {
        this.log('[MyFunPlugin] Post-block processing:', decodedBlock.transactions.length, 'txs');
        // Great place to update indexes, or trigger any custom logic
    }

    // Called when new transactions are added to the mempool
    protected async onMempoolUpdate(transactionInfo: MempoolTxs[]): Promise<void> {
        this.log('[MyFunPlugin] Mempool update:', transactionInfo.txHash);
    }

    // Called upon receiving witness data
    protected async onWitnessData(witnessInfo: WitnessData): Promise<void> {
        this.log('[MyFunPlugin] Witness data received:', witnessInfo);
    }

    protected async startThread(): Promise<void> {
        // Start your own background thread
        this.postToThread({ action: 'init', payload: { /* any data */ } });
    }

    protected async onConsensusUpgrade(): Promise<void> {
        this.log('[MyFunPlugin] Consensus upgrade detected');
        // Handle consensus upgrade logic here
    }

    // Handle messages from the worker thread
    protected async onThreadMessage(msg: unknown): Promise<void> {
        console.log('[MyFunPlugin] Message from worker thread:', msg);
    }
}
```

---

## Publishing Your Plugin

1. **Package Your Plugin**: Ensure your plugin has a `plugin.json` or similar descriptor with the necessary metadata.
2. **Publish to Registry**: You can publish your plugin to the default OPNet plugin registry or your own private
   registry.
3. **Documentation**: Provide comprehensive readme and inline code comments.
4. **Test**: Thoroughly test your plugin against various node versions to ensure compatibility.

Once published, your plugin can be installed using the standard OPNet command:

```bash
opnet plugin install <your-plugin-name>
```
