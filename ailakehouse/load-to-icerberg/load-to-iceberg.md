# Load Data to an Apache Iceberg Catalog Server

## Introduction

**PeakGear** has prepared product data in an Oracle Autonomous Database table. This scene shows how **Oracle Data Transforms** publishes that data as an **Apache Iceberg** table.

The prepared load reads `GOLD_PRODUCTS` from the Oracle `PG` schema and writes it to the `GOLD` namespace in the Iceberg catalog. It appends the data to the target table and leaves the Oracle source unchanged.

The prepared flow uses **Iceberg incremental load** in **Oracle Data Transforms** to publish the table through the Iceberg Catalog Server.

Other tools that support Iceberg can then use the same product data.

Estimated Time: **10 minutes**

>**Note**: You must have finished the scene Transform Iceberg Data!

### Objectives

In this scene, you will:

- Publish prepared PeakGear product data from Oracle to an Apache Iceberg table.
- Review where the data comes from and where it will be written.
- Run the prepared data load.
- Confirm that the Iceberg table contains the product data.

## Task 1: Open and sign in to Data Transforms

Open **Data Transforms**:

1. Click **Open Data Transforms**.
2. Copy the displayed PG username and password from the **Login information** panel.
3. Enter those credentials and click **Connect**.
4. Keep the LiveStack tab open so that you can return to the demo page if needed.

## Task 2: Open the preconfigured data load

The environment already contains the project, connections, schemas, and data load for this scene. You do not need to create them manually.

1. From the Data Transforms home page, open **Projects**.
2. Open the project named `peakgear`.
   
  ![2026-08-19-004716](images/2026-08-19-004716.png) 

3. In the project resources, open **Data Loads**.
4. Open the data load named `dataLoad`.

  ![2026-08-19-004717](images/2026-08-19-004717.png)

If the project or data load is not visible, wait a moment and refresh the page. The environment may still be finishing its setup.

## Task 3: Inspect the source and target configuration

Review the data load configuration before starting it. The prepared load uses these source and target settings:

| Setting               | Configuration       |
| -----------------------| ---------------------|
| Data load             | `dataLoad`          |
| Project               | `peakgear`          |
| Source technology     | Oracle              |
| Source schema         | `PG`                |
| Source table          | `GOLD_PRODUCTS`     |
| Target technology     | Apache Iceberg      |
| Target namespace      | `GOLD`              |
| Load mode             | Iceberg incremental |
| Target preload action | Append              |

The source is the transformed product data created in the previous scene. The load publishes that data to the Iceberg catalog; it does not change the Oracle source table.

Confirm these settings in the data load editor:

1. The source model uses the Oracle connection and the `PG` schema.
2. `GOLD_PRODUCTS` is selected as the source table.
3. The target model uses the Apache Iceberg connection and the `GOLD` namespace.
4. The target preload action is **Append**.

![2026-08-19-004718](images/2026-08-19-004718.png)


## Task 4: Validate and run the data load

Run the prepared data load:

1. Click **Save** if Data Transforms shows unsaved changes.
2. Validate the data load and confirm that no validation errors are reported.
3. Click **Start** to run `dataLoad`.

![2026-08-19-004719](images/2026-08-19-004719.png) 

4. Open the displayed **Job**.

![2026-08-19-004720](images/2026-08-19-004720.png)

5. Monitor the job until its status is **Successful** or **Completed**.

![2026-08-19-004721](images/2026-08-19-004721.png)

The first run creates or appends `GOLD_PRODUCTS` in the Iceberg `GOLD` namespace. Because the target action is **Append**, start the load again only if you intend to add another copy of the source rows.


## Bonus Task: Verify the loaded data

Verify that the catalog server contains the new `GOLD_PRODUCTS` table with the Iceberg catalog REST API:

1. On the **View Login Information** screen, copy the IP address without the port:
   
   ![2026-08-19-004722](images/2026-08-19-004722.png)

2. Create the REST API URL by replacing `<IP_ADDRESS>` in the following address with the copied IP address:

  `<IP_ADDRESS>:1525/iceberg/v1/namespaces/gold/tables/GOLD_PRODUCTS`


3. Open the URL in a browser and review the response. It should show the table definition and Iceberg metadata.


![2026-08-19-004723](images/2026-08-19-004723.png)


## Conclusion: Business Outcome

PeakGear can publish prepared product data from Oracle as an Apache Iceberg table. Other tools that support Iceberg can then use the same table without connecting directly to Oracle.

The load reads `PG.GOLD_PRODUCTS`, writes to the `GOLD` namespace, and leaves the Oracle source unchanged.

## Acknowledgements

* **Author** - Kevin Lazarz August 2026
* **Contributor** - Eugenio Galiano
* **Last Updated By/Date** - Kevin Lazarz  August 2026
