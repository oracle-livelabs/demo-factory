# Scene 7 Service Request Workbench

## Introduction

**Maria Santos** now moves from **Western Slope** pressure to one **Colorado** resident request. The **Service Request Workbench** connects the request, resident, in-state service center, request line items, route evidence, JSON document, and active field task under the same regional **VPD** context.

Estimated Time: **10 minutes**

<video controls width="100%">
  <source src="https://c4u04.objectstorage.us-ashburn-1.oci.customer-oci.com/p/EcTjWk2IuZPZeNnD_fYMcgUhdNDIDA6rt9gaFj_WZMiL7VvxPBNMY60837hu5hga/n/c4u04/b/livelabsfiles/o/livestack/Videos/State-and-Local-Gov/State and Local Government_Scene7_with-CC.mp4">
  Your browser does not support the video tag.
</video>
### Objectives

In this scene, you will review **Maria Santos**'s regional queue, inspect one request through three governed views, distinguish request status from service-task status, and explain Field Resolution Underway.

## Task 1: Review the Western Slope request queue

Perform the following set of steps to review the **Western Slope** request queue under **Maria Santos**'s regional access:

1. Keep Maria Santos selected.
2. Click **Service Request Workbench** in the sidebar.
3. Confirm the **Regional VPD** banner and Western Slope scope.
4. Filter to **In Progress**.
5. Select the first visible In Progress request that has a populated Colorado service site and service task. Do not rely on a fixed request number.

    ![Western Slope request list with approved lifecycle labels](images/service-request-workspace.png)

The queue contains only requests **Maria Santos** is authorized to see. Status filters use business-facing request language and should not expose internal compatibility enums.

## Task 2: Inspect the relational request evidence

Perform the following set of steps to inspect the relational request evidence for the selected resident request:

1. Keep the selected request expanded.
2. Open **Relational**.
3. Compare the resident, Colorado location, in-state service center, service value, route cost, creation date, and Request Line Items.
4. Confirm that dates are valid and the resident and assigned center are geographically plausible.

    ![Relational request detail with resident, center, route cost, and Request Line Items](images/service-request-relational-detail.png)

**Request Line Items:** Number of individual service or eligibility items included in the resident request. They explain the work contained in the overall case; they are not a route or geographic count.

The request lifecycle describes the overall agency case:

**Submitted → Accepted → In Review → In Progress → Completed**

**Needs Follow-Up** and **Cancelled** are alternate request outcomes.

## Task 3: Compare the JSON Duality document

Perform the following set of steps to compare the **JSON Duality View** with the relational request evidence:

1. Click **JSON Duality View**.
2. Locate the same request header and nested Request Line Items.
3. Compare the public JSON names with the relational fields.
4. Explain that JSON Relational Duality exposes the same transaction without a duplicated document database or synchronization step.

    ![JSON Duality document for the same Colorado service request](images/service-request-json-duality.png)

The relational and document views represent the same governed request. **Maria Santos** does not gain additional rows by changing the application interface.

## Task 4: Inspect the Service Task Route

Perform the following set of steps to inspect the **Service Task Route** and explain how the active field task connects to the request:

1. Click **Service Task Route**.
2. Compare the Colorado resident and in-state center, distance, estimated travel time, route cost, and current task status.
3. Review the full service-task timeline.

    ![Service Task Route with the complete field-resolution lifecycle](images/service-task-route-progress.png)

The service-task lifecycle describes execution of the assigned work:

**Intake → Assigned → Scheduled → Dispatched → In Progress → Field Resolution Underway → Completed**

**Blocked** is the exception outcome.

**Field Resolution Underway** means the assigned in-state team is actively resolving the request in the resident's service area. The selected task may currently be In Progress, while the complete timeline shows **Field Resolution Underway** as the next operational stage.

## Task 5: Connect the request to Oracle evidence

Perform the following set of steps to connect the request, protected child records, and route evidence to Oracle internals:

1. Click **Show Oracle Internals**.
2. Review JSON Duality, Spatial routing, and VPD evidence.
3. Explain that the request and protected child records remain governed under the same regional context.
4. Return to Jessica Chen before moving to statewide analytics.

    ![Oracle Internals for JSON Duality Spatial routing and VPD](images/service-request-oracle-evidence.png)

**Maria Santos** has moved from a regional pressure signal to an individual request and active field response without seeing another **Colorado** service region. **Jessica Chen** can now return to the statewide view and decide where capacity should be monitored or rebalanced.

*You can move to the next scene.*

## Credits & Build Notes

- **Author** - Oracle LiveLabs Team
- **Last Updated By/Date** - Oracle LiveLabs Team, 2026-07-03
