# Scene 3 Operations Command Center

## Introduction

The **Operations Command Center** helps healthcare leaders answer a daily operating question: *Where does the network need attention right now?*

The page brings together service demand, value, quality signals, watched services, logistics pressure, and AI activity so teams can decide where to investigate first.

Dashboards like this are difficult to implement when care sites, service requests, signal bulletins, supply data, logistics networks, and agent activity live in different systems. Teams often need copied extracts, separate BI models, and reconciliation logic before a dashboard can show a trustworthy view.

Oracle AI Database helps address that challenge by keeping operational, analytical, JSON, in-memory, and AI-ready data close to the same governed data foundation. In this scene, the dashboard brings together live healthcare KPIs, signal velocity, care category value, and watched services without sending the user to another application.

Estimated Time: 10 minutes

<video controls width="100%">
  <source src="https://c4u04.objectstorage.us-ashburn-1.oci.customer-oci.com/p/EcTjWk2IuZPZeNnD_fYMcgUhdNDIDA6rt9gaFj_WZMiL7VvxPBNMY60837hu5hga/n/c4u04/b/livelabsfiles/o/livestack/Videos/Healthcare/Seer Health_Scene-2_with-CC_.mp4" type="video/mp4">
  Your browser does not support the video tag.
</video>

### Objectives

In this scene, you will learn what healthcare decision the page supports, what evidence the user should inspect, and what action the team may take next.

**Note:** Review the Oracle Internals sidebar after the business flow is clear. Use it to connect the visible healthcare outcome to the database capabilities behind the page.

## Task 1: Review the command center dashboard

Use the dashboard as a daily triage view. The goal is to see where service demand, value, quality signals, logistics pressure, or AI activity suggests the network needs attention.

1. Click **Operations Command Center** in the sidebar.
2. Review the KPI cards across the top of the page.
3. Review **Care Operations Signal Velocity**.
4. Review **Service Value by Care Category**.
5. Review **Watched Services and Supplies - Quality and Capacity Trend**.



    ![Operations Command Center KPI cards, signal velocity, and service value areas highlighted](images/command-center-kpis-overview.png)

6. Review the Oracle Internals sidebar after the business flow is clear. Use it to connect the visible healthcare outcome to the database capabilities behind the page.

In the current demo dataset, the page shows **3.0K** service requests logged, about **$4.21M** in tracked service value, **474** critical signals flagged, **156** care services under watch, and **1** completed agent action. Use those numbers to frame the command center as a triage surface: the user can see demand, value, signal pressure, watched services, and AI activity in one place.

**Note:** Sample values may change after data refreshes or rebuilds. Verify live output before presenting, then explain the business takeaway.

## Task 2: Interpret signal velocity and service value

Perform the following set of steps to understand where operational importance and risk are moving at the same time. This helps leaders decide which categories may need review, staffing, supply action, or follow-up.

1. Click a signal velocity time range such as **24h**, **48h**, or **7d**.
2. Review how the signal chart changes by time bucket.
3. Review the service value chart by care category.
4. Focus on visible categories such as **Pharmacy Supply**, **Quality and Safety**, **Clinical Supplies**, **Diagnostics**, and **Specialty Care**.

    ![Signal velocity time controls, chart, and service value breakdown highlighted](images/signal-velocity-and-service-value.png)

The key business story is that healthcare users need to know where value, volume, and risk are moving together so they can choose the right operating response.

## Task 3: Review watched services and supplies

Perform the following set of steps to move from dashboard-level pressure to specific services, suppliers, or quality processes that may need attention.

1. Use the watched services search box to filter for a care service, supply, or partner.
2. Review the top watched rows.

    ![Watched services table with search filters and top care-service rows highlighted](images/watched-services-and-supplies.png)

3. Focus on rows such as **Tamper-Evident Carton Batch**, **Quality Review Variation Dossier Review**, or **mRNA LNP Clinical Batch - Continuity Lot 2**.
4. Review the columns for provider network or partner, signal count, network impact, trend, and next step.

The watched services table turns the KPI story into a set of operating decisions. A healthcare leader can move from "critical signals are high" to a specific care service, supplier, or quality process that needs review.

*You can move to the next scene.*

## Credits & Build Notes
- **Author** - Oracle LiveLabs Team
- **Last Updated By/Date** - Oracle LiveLabs Team, 2026-05-22
