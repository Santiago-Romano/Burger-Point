// Envío best-effort del email de confirmación de pedido vía Resend.
// Sin RESEND_API_KEY configurada no se envía nada y el pedido sigue normal.
// Los errores de email nunca bloquean ni fallan el pedido (fail-open).

type OrderEmailInput = {
  to: string;
  orderNumber: number;
  customerName: string;
  deliveryType: string;
  total: number | null;
  trackingUrl: string;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function buildTrackingUrl(clientOrderId: string): string {
  const base = (
    process.env["PUBLIC_SITE_URL"] ??
    process.env["URL"] ??
    process.env["DEPLOY_PRIME_URL"] ??
    ""
  ).replace(/\/+$/, "");
  return base ? `${base}/seguimiento/${clientOrderId}` : "";
}

export async function sendOrderReceivedEmail(input: OrderEmailInput): Promise<void> {
  const apiKey = process.env["RESEND_API_KEY"];
  if (!apiKey) return;

  const from = process.env["RESEND_FROM"] ?? "Burger Point <onboarding@resend.dev>";
  const subject = `Pedido #${input.orderNumber} recibido — Burger Point`;
  const total =
    input.total != null ? `$ ${input.total.toLocaleString("es-AR")}` : "Se confirma en el local";
  const deliveryLine = input.deliveryType === "delivery" ? "Delivery" : "Retiro en el local";
  const trackingLine = input.trackingUrl
    ? `\nSeguí tu pedido acá: ${input.trackingUrl}`
    : "";
  const text = [
    `¡Gracias ${input.customerName}!`,
    "",
    `Recibimos tu pedido #${input.orderNumber} (${deliveryLine}).`,
    `Total: ${total}`,
    "Te avisamos cuando esté en camino.",
    trackingLine,
  ]
    .filter(Boolean)
    .join("\n");
  const html = `
<p>¡Gracias <strong>${escapeHtml(input.customerName)}</strong>!</p>
<p>Recibimos tu pedido <strong>#${input.orderNumber}</strong> (${escapeHtml(deliveryLine)}).</p>
<p>Total: <strong>${escapeHtml(total)}</strong></p>
<p>Te avisamos cuando esté en camino.</p>
${
  input.trackingUrl
    ? `<p><a href="${input.trackingUrl}">Ver estado del pedido</a></p>`
    : ""
}
`.trim();

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [input.to], subject, text, html }),
    });
    if (!response.ok) {
      console.error("[email] Resend rechazó el envío del email:", response.status);
    }
  } catch (error) {
    console.error("[email] No se pudo enviar el email de confirmación:", error);
  }
}
