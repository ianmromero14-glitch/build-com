// Vercel Cron Job - runs daily to send reminder emails for tomorrow's jobs/inspections/follow-ups
const SUPABASE_URL = "https://zbvxrwftgtiwtlqzgztv.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpidnhyd2Z0Z3Rpd3RscXpnenR2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3NzU4NDgsImV4cCI6MjA5NjM1MTg0OH0.uuyQAAeJxtlf6FzjRMEUvdfTy5VD3j3mfy8G_lXx_ag";
const RESEND_KEY = "re_N8yv9ks4_26JJGC57Z9pkVrXGidhmqsF9";

export default async function handler(req, res) {
  // Verify this is being called by Vercel Cron (security check)
  const authHeader = req.headers["authorization"];
  if (authHeader !== "Bearer " + process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    // Calculate tomorrow's date range
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStart = new Date(tomorrow.setHours(0, 0, 0, 0)).toISOString();
    const tomorrowEnd = new Date(tomorrow.setHours(23, 59, 59, 999)).toISOString();
    const tomorrowDateOnly = tomorrowStart.slice(0, 10);

    const headers = { "apikey": SUPABASE_KEY, "Authorization": "Bearer " + SUPABASE_KEY };

    // Fetch leads with inspections or follow-ups tomorrow
    const leadsRes = await fetch(SUPABASE_URL + "/rest/v1/leads?select=*", { headers });
    const leads = await leadsRes.json();

    const inspectionsTomorrow = leads.filter(function(l) {
      if (!l.inspection_date) return false;
      return l.inspection_date >= tomorrowStart && l.inspection_date <= tomorrowEnd;
    });
    const followUpsTomorrow = leads.filter(function(l) {
      if (!l.follow_up_date) return false;
      return l.follow_up_date >= tomorrowStart && l.follow_up_date <= tomorrowEnd;
    });

    // Fetch jobs starting tomorrow
    const jobsRes = await fetch(SUPABASE_URL + "/rest/v1/jobs?select=*", { headers });
    const jobs = await jobsRes.json();
    const jobsTomorrow = jobs.filter(function(j) {
      return j.start_date === tomorrowDateOnly;
    });

    // Fetch tasks due tomorrow
    const tasksRes = await fetch(SUPABASE_URL + "/rest/v1/tasks?select=*&status=eq.Pending", { headers });
    const tasks = await tasksRes.json();
    const tasksTomorrow = tasks.filter(function(t) {
      return t.due === tomorrowDateOnly;
    });

    const totalItems = inspectionsTomorrow.length + followUpsTomorrow.length + jobsTomorrow.length + tasksTomorrow.length;

    // If nothing is scheduled, skip sending an email
    if (totalItems === 0) {
      return res.status(200).json({ message: "Nothing scheduled for tomorrow, no email sent" });
    }

    // Build email HTML
    var html = "<div style='font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;'>";
    html += "<h2 style='color:#111827;'>Tomorrow's Schedule</h2>";
    html += "<p style='color:#6B7280;'>" + new Date(tomorrowStart).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) + "</p>";

    if (jobsTomorrow.length > 0) {
      html += "<h3 style='color:#111827;margin-top:24px;'>Jobs Starting</h3>";
      jobsTomorrow.forEach(function(j) {
        html += "<div style='background:#F9FAFB;border-radius:12px;padding:12px;margin-bottom:8px;'>";
        html += "<p style='margin:0;font-weight:600;'>" + j.title + "</p>";
        html += "<p style='margin:0;color:#6B7280;font-size:14px;'>" + (j.customer || "") + (j.address ? " - " + j.address : "") + "</p>";
        html += "</div>";
      });
    }

    if (inspectionsTomorrow.length > 0) {
      html += "<h3 style='color:#111827;margin-top:24px;'>Inspections</h3>";
      inspectionsTomorrow.forEach(function(l) {
        const time = new Date(l.inspection_date).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
        html += "<div style='background:#F3E8FF;border-radius:12px;padding:12px;margin-bottom:8px;'>";
        html += "<p style='margin:0;font-weight:600;'>" + l.name + " - " + time + "</p>";
        html += "<p style='margin:0;color:#6B7280;font-size:14px;'>" + (l.address || "") + (l.phone ? " - " + l.phone : "") + "</p>";
        html += "</div>";
      });
    }

    if (followUpsTomorrow.length > 0) {
      html += "<h3 style='color:#111827;margin-top:24px;'>Follow-Ups</h3>";
      followUpsTomorrow.forEach(function(l) {
        html += "<div style='background:#FFEDD5;border-radius:12px;padding:12px;margin-bottom:8px;'>";
        html += "<p style='margin:0;font-weight:600;'>" + l.name + "</p>";
        html += "<p style='margin:0;color:#6B7280;font-size:14px;'>" + (l.phone || "") + "</p>";
        html += "</div>";
      });
    }

    if (tasksTomorrow.length > 0) {
      html += "<h3 style='color:#111827;margin-top:24px;'>Tasks Due</h3>";
      tasksTomorrow.forEach(function(t) {
        html += "<div style='background:#F3F4F6;border-radius:12px;padding:12px;margin-bottom:8px;'>";
        html += "<p style='margin:0;font-weight:600;'>" + t.title + "</p>";
        if (t.assigned) html += "<p style='margin:0;color:#6B7280;font-size:14px;'>Assigned: " + t.assigned + "</p>";
        html += "</div>";
      });
    }

    html += "<a href='https://build-com-topaz.vercel.app' style='display:inline-block;margin-top:24px;background:#111827;color:white;padding:12px 24px;border-radius:12px;text-decoration:none;font-weight:600;'>Open Simplicity CRM</a>";
    html += "</div>";

    // Send the email via Resend
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + RESEND_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Simplicity CRM <onboarding@resend.dev>",
        to: "ianmromero14@gmail.com",
        subject: "Tomorrow's Schedule - " + totalItems + " item" + (totalItems > 1 ? "s" : ""),
        html: html,
      }),
    });

    return res.status(200).json({ message: "Reminder email sent", items: totalItems });
  } catch (error) {
    console.error("Cron job error:", error);
    return res.status(500).json({ error: error.message });
  }
}
