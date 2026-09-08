# PeakGear AI Lakehouse 60 Minute Recommended Path

## Introduction

**PeakGear Sporting Goods** is a fictional retailer with product, order, inventory, fulfillment, demand, and returns data arriving from different sources. PeakGear uses an **AI Lakehouse** to bring those records into one connected flow and serve the resulting data to business users, applications, and AI experiences.

This 60-minute path starts with customer and operational outcomes, then follows the ingest, catalog, and transformation scenes that support them. It covers PeakGears' customer shopping portal, operational monitoring, return-risk analysis, data questions, retail operations agents, real-time and change-data-capture ingest, catalog explanations, and Iceberg data movement.


Estimated Time: **60 minutes**


### Objectives

In this path, you will:

- Start with the web shop experience, operational monitoring, return-risk analysis, and data-driven retail questions.
- Show how **Retail Operations Agents** use prepared data to answer an urgent demand question.
- Ingest data into **Bronze** through real-time streaming and change data capture.
- Review **Data Catalog** and **AI Table Explain** for a curated product table.
- Follow Iceberg data through the transformation and catalog-loading scenes.

## Demo Flow

Use the following sequence. The time allocations are a suggested speaking and interaction budget for a prepared environment. The order works for a 60-minute overview: the first five scenes establish the visible outcomes, then the final five scenes show the data and service work behind them.

| Time | Scene | Show |
| ---: | --- | --- |
| 5 minutes | [PeakGear Webshop and Product Discovery](http://127.0.0.1:5501/ailakehouse/workshops/sandbox/index.html?lab=peakgear-webshop-and-product-discovery) | Use Meaning Search, Visual Search, and Ask PeakGear with order **7820**. |
| 5 minutes | [Operations Dashboard](http://127.0.0.1:5501/ailakehouse/workshops/sandbox/index.html?lab=operations-dashboard) | Review **Watched Products**, its converged query, and one operational drill-down. |
| 5 minutes | [Returns Risk Network](http://127.0.0.1:5501/ailakehouse/workshops/sandbox/index.html?lab=returns-risk-network) | Explore connected return-risk evidence and run **Review Priority Hubs**. |
| 5 minutes | [Ask Your Data](http://127.0.0.1:5501/ailakehouse/workshops/sandbox/index.html?lab=ask-your-data) | Ask a revenue question, inspect the generated SQL, and review the result set. |
| 5 minutes | [Retail Operations Agents](http://127.0.0.1:5501/ailakehouse/workshops/sandbox/index.html?lab=retail-operations-agents) | Ask for urgent demand signals and review the response, tools, and recent actions. |
| 10 minutes | [Real-Time Streaming Ingest](http://127.0.0.1:5501/ailakehouse/workshops/sandbox/index.html?lab=ingest-real-time-and-batch-data) | Start the prepared stream and watch demand events enter `PG.BRONZE_DEMAND_SIGNALS`. |
| 10 minutes | [Change Data Capture Ingest](http://127.0.0.1:5501/ailakehouse/workshops/sandbox/index.html?lab=change-data-capture) | Start the prepared CDC pipeline, insert a customer change, and verify the Bronze mirror. |
| 5 minutes | [Data Catalog and AI Table Explain](http://127.0.0.1:5501/ailakehouse/workshops/sandbox/index.html?lab=data-catalog) | Find `DIM_PRODUCT`, use AI Table Explain, and create the margin-enriched view. |
| 5 minutes | [Transform Iceberg Data](http://127.0.0.1:5501/ailakehouse/workshops/sandbox/index.html?lab=process-bronze-to-silver) | Read the Iceberg-backed Bronze source, apply the `SUBCATEGORY` rule, and write `GOLD_PRODUCTS`. |
| 5 minutes | [Load Data to an Apache Iceberg Catalog Server](http://127.0.0.1:5501/ailakehouse/workshops/sandbox/index.html?lab=load-to-icerberg) | Inspect and run the prepared flow that writes data to the Iceberg Catalog Server. |

This 60-minute route gives you a focused view of the AI Lakehouse flow, with extra time for the two ingest scenes and focused checkpoints for catalog and Iceberg processing. To work through every step in scenes 6 through 10, plan about 75 minutes. The linked scenes provide the full walkthrough.

## Conclusion: Business Outcome

This 60-minute route makes the AI Lakehouse flow visible from business outcome to data foundation. It covers product discovery, operations, return-risk analysis, data questions, agents, Bronze ingest, catalog explanation, and Iceberg processing. The route shows the main result in all ten scenes; the full interactive procedures for the final five scenes need additional time.

Most scenes remain useful on their own. Use the scene catalog to focus on a specific ingest method, data product, business outcome, or technical detail.

## Acknowledgements

* **Author** - Kevin Lazarz September 2026
* **Contributor** - Eugenio Galiano
* **Last Updated By/Date** - Kevin Lazarz September 2026
