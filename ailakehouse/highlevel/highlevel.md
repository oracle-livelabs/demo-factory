# PeakGear AI Lakehouse 30 Minute Recommended Path

## Introduction

**PeakGear Sporting Goods** is the fictional retail business used throughout this LiveStack. The demo connects product, order, inventory, demand, fulfillment, and returns data in an **AI Lakehouse**.

This path gives a high-level view of that flow in 30 minutes. It starts with customer and operations outcomes, then shows how the lakehouse receives live demand events and processes Iceberg-backed data.

Estimated Time: **30 minutes**

### Objectives

In this path, you will:

- See how curated product data supports shopper search, Visual Search, and Ask PeakGear.
- Review the **Watched Products** table and its converged query in the **Operations Dashboard**.
- Investigate connected return-risk evidence in the **Returns Risk Network**.
- Show how live demand events enter the **Bronze** layer for later processing.
- Show how **Data Transforms** reads an Iceberg-backed table and writes `GOLD_PRODUCTS`.

## Demo Flow

Use the following sequence. The time allocations are a suggested speaking and interaction budget, assuming the environment is prepared.

| Time       | Scene                                                                                 | Show                                                                                                |
| -----------:| ---------------------------------------------------------------------------------------| -----------------------------------------------------------------------------------------------------|
| 10 minutes | [PeakGear Webshop and Product Discovery](?lab=peakgear-webshop-and-product-discovery) | Meaning Search, Visual Search, and Ask PeakGear with order **7820**.                                |
| 5 minutes  | [Operations Dashboard](?lab=operations-dashboard)                                     | The **Watched Products** table, the converged query, and one product detail.                        |
| 5 minutes  | [Returns Risk Network](?lab=returns-risk-network)                                     | A connected return-risk entity, graph depth, and **Review Priority Hubs**.                          |
| 5 minutes  | [Real-Time Streaming Ingest](?lab=ingest-real-time-and-batch-data)                    | Start the prepared stream and watch demand events enter `PG.BRONZE_DEMAND_SIGNALS`.                 |
| 5 minutes  | [Transform Iceberg Data](?lab=process-bronze-to-silver)                               | The Iceberg-backed Bronze source, the `SUBCATEGORY` transformation, and the `GOLD_PRODUCTS` target. |

This sequence fits into 30 minutes if you keep each scene focused. The full scenes contain additional setup, troubleshooting, and verification steps.

## Conclusion: Business Outcome

This 30-minute route connects customer, operations, and return-risk outcomes to two data-foundation proof points. PeakGear can use curated data for product discovery, operational monitoring, and return-risk investigation while continuing to process Iceberg-backed tables and live demand events through the lakehouse.

For the complete task lists and verification steps, return to the linked scene pages.

## Acknowledgements

* **Author** - Kevin Lazarz August 2026
* **Contributor** - Eugenio Galiano
* **Last Updated By/Date** - Kevin Lazarz  August 2026
