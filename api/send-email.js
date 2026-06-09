export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  
  const { to, subject, html } = req.body;
  
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer re_N8yv9ks4_26JJGC57Z9pkVrXGidhmqsF9`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Simplicity CRM <onboarding@resend.dev>",
      to: ["ianmromero14@gmail.com"],
      subject,
      html,
    }),
  });

  const data = await response.json();
  res.status(response.ok ? 200 : 400).json(data);
}
