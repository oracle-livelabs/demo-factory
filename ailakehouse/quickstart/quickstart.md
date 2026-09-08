# PeakGear AI Lakehouse 10 Minute Recommended Path

## Introduction

**PeakGear Sporting Goods** is a fictional retailer with product, order, inventory, fulfillment, and demand data arriving from multiple sources. PeakGear uses an **AI Lakehouse** to bring those records into one data flow for digital commerce and day-to-day operations.

The data moves through a medallion process. **Bronze** preserves source-shaped data. **Silver** cleans and enriches it. **Gold** publishes data products for applications, dashboards, and AI experiences. The path below shows four results of that process: shoppers find products by intent, support can use order context, operations can review demand against fulfillment capacity, and new demand events can enter Bronze.

The suggested flow is designed for a quick pass highlighting some business outcomes that can only be achieved using curated data products. It also provides a demo that demonstrates how real time data can be easily ingested in to Autonomous AI Lakehouse.

Estimated Time: **10 to 15 minutes**

### Objectives

In this path, you will:

- Search the **PeakGear Webshop** using shopper intent and a curated catalog data product.
- Use **Ask PeakGear** to troubleshoot an order issue for order **7820**.
- Review the **Watched Products** table and its converged query in the **Operations Dashboard**.
- Start a real-time demand stream and watch events arrive in the **Bronze** layer.

### Prerequisites

Before you begin, open the running PeakGear Sporting Goods LiveStack in a modern browser. The demo uses prepared data. You do not need coding or database administration knowledge.

## Demo Flow

Use this sequence for a focused 10 to 15 minute view of the main business outcomes.

| Time      | Scene                                                                                 | Show                                                                                              |
| ----------:| ---------------------------------------------------------------------------------------| ---------------------------------------------------------------------------------------------------|
| 5 minutes | [PeakGear Webshop and Product Discovery](?lab=peakgear-webshop-and-product-discovery) | Meaning Search, near-database vector search, Visual Search, and Ask PeakGear with order **7820**. |
| 5 minutes | [Operations Dashboard](?lab=operations-dashboard)                                     | The **Watched Products** table and its converged query with operational context.                  |
| 5 minutes | [Real-Time Streaming Ingest](?lab=ingest-real-time-and-batch-data)                    | Start the prepared stream and watch new demand events enter `PG.BRONZE_DEMAND_SIGNALS`.           |

The table uses five-minute blocks. A focused pass should fit within 10 to 15 minutes, while the linked scenes provide the complete task steps when more detail is needed. You can always spend more time in any scene.

## Conclusion: Business Outcome

These three stops connect a customer experience to the data behind it. The curated Gold data product supports shopper search and guided support. The Operations Dashboard joins demand with fulfillment context. Real-time streaming shows how new demand signals enter Bronze before Silver and Gold processing. Continue with the [30 minute](?lab=highlevel) or [60 minute](?lab=extended) path to go deeper.

For PeakGear, teams can reuse the same prepared data in commerce, service, operations, and AI features. The demo keeps the path visible: use the product data, inspect the operational view, then watch a new event enter the lakehouse.

## Acknowledgements

* **Author** - Kevin Lazarz September 2026
* **Contributor** - Eugenio Galiano
* **Last Updated By/Date** - Kevin Lazarz September 2026
