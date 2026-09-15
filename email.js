const path = require('path');
const dotenv = require('dotenv');
const nodemailer = require('nodemailer');

dotenv.config({ path: path.join(__dirname, '../../.env') });

const completion_mail_content = (customer_name, order_id, pickup_time, pickup_qr_code, pickup_code, store_address, store_phone, store_location) => 
    `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>UniKart Print Ready</title></head><body style="margin:0;padding:0;background:#f3f6fb;font-family:Inter,Segoe UI,Arial,sans-serif;"><table width="100%" cellpadding="0" cellspacing="0"style="background:#f3f6fb;padding:40px 15px;"><tr><td align="center"><table width="620"cellpadding="0"cellspacing="0"style="max-width:620px;background:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 15px 40px rgba(0,0,0,.08);"><!-- HEADER --><tr><td align="center"style="padding:45px 30px;background:linear-gradient(135deg,#f97316,#ea580c);"><div style="width:85px;height:85px;border-radius:50%;background:rgba(255,255,255,.18);font-size:42px;line-height:85px;">🖨️</div><h1 style="margin:22px 0 10px;font-size:32px;color:#ffffff;">Your Print is Ready!</h1><p style="margin:0;font-size:16px;color:#ffedd5;">Come and collect your documents</p></td></tr><!-- BODY --><tr><td style="padding:45px;"><h2 style="margin:0;font-size:26px;color:#111827;">Hello ${customer_name} 👋</h2><p style="margin-top:18px;font-size:16px;line-height:28px;color:#6b7280;">Great news! Your printing order has been completed successfully.Your documents are now printed and ready for collection at UniKart.</p><!-- READY CARD --><table width="100%"style="margin:30px 0;background:#fff7ed;border-radius:18px;"><tr><td style="padding:25px;"><table width="100%"><tr><td width="55"><div style="width:45px;height:45px;border-radius:50%;background:#f97316;color:white;font-size:24px;line-height:45px;text-align:center;">✓</div></td><td><h3 style="margin:0;font-size:18px;color:#9a3412;">Ready For Pickup</h3><p style="margin:8px 0 0;font-size:14px;color:#c2410c;">Your print order is completed</p></td></tr></table></td></tr></table><!-- ORDER INFO --><h3 style="font-size:18px;color:#111827;margin-bottom:15px;">Collection Details</h3><table width="100%"cellpadding="12"style="border-collapse:collapse;border:1px solid #e5e7eb;border-radius:14px;"><tr style="background:#f9fafb;"><td style="color:#6b7280;">Order ID</td><td align="right"style="font-weight:600;">${order_id}</td></tr><tr><td style="color:#6b7280;">Status</td><td align="right"style="font-weight:700;color:#f97316;">READY</td></tr><tr style="background:#f9fafb;"><td style="color:#6b7280;">Pickup Time</td><td align="right">${pickup_time}</td></tr></table><!-- QR SECTION --><table width="100%"style="margin-top:30px;background:#f8fafc;border-radius:18px;"><tr><td align="center"style="padding:30px;"><p style="margin:0 0 20px;font-size:14px;font-weight:600;color:#475569;">Show this QR at pickup</p><div style="padding:12px;background:#ffffff;border:2px dashed #cbd5e1;border-radius:16px;display:inline-block;"><img src="${pickup_qr_code}" alt="QR Code" width="140" height="140" style="display:block;border-radius:8px;"/></div><p style="margin:15px 0 0;font-size:12px;color:#94a3b8;font-weight:bold;letter-spacing:1px;">${pickup_code}</p></td></tr></table><!-- STORE CARD --><table width="100%"style="margin-top:30px;background:#eff6ff;border-radius:18px;"><tr><td style="padding:25px;"><h3 style="margin:0 0 15px;font-size:18px;color:#1e40af;">📍 Pickup Location</h3><p style="margin:5px 0;font-size:15px;color:#374151;line-height:24px;"><strong>UniKart Print Center</strong><br>${store_address}<br>Contact: ${store_phone}</p></td></tr></table><!-- INSTRUCTIONS --><h3 style="margin-top:35px;font-size:18px;color:#111827;">Collection Instructions</h3><table width="100%"><tr><td style="font-size:14px;color:#4b5563;padding:8px 0;">✓ Bring your Order ID or QR code</td></tr><tr><td style="font-size:14px;color:#4b5563;padding:8px 0;">✓ Verify your printed documents before leaving</td></tr><tr><td style="font-size:14px;color:#4b5563;padding:8px 0;">✓ Contact support for any correction request</td></tr></table><!-- BUTTON --><div style="text-align:center;margin-top:40px;"><a href="${store_location}"style="display:inline-block;background:#f97316;color:white;padding:16px 45px;border-radius:12px;font-weight:600;font-size:16px;text-decoration:none;">View Pickup Location →</a></div></td></tr><!-- FOOTER --><tr><td align="center"style="background:#f9fafb;padding:30px;"><h3 style="margin:0;font-size:22px;color:#f97316;">UniKart</h3><p style="margin:10px 0 0;font-size:13px;color:#9ca3af;">Fast Printing • Easy Pickup • Happy Customers</p><p style="margin:15px 0 0;font-size:12px;color:#9ca3af;">© 2026 UniKart. All Rights Reserved.</p></td></tr></table></td></tr></table></body></html>`

const cancellation_mail_content = (customer_name, order_id, cancellation_reason, store_address, store_phone, store_location) => 
    `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>UniKart Order Cancelled</title></head><body style="margin:0;padding:0;background:#f3f6fb;font-family:Inter,Segoe UI,Arial,sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f6fb;padding:40px 15px;"><tr><td align="center"><table width="620" cellpadding="0" cellspacing="0"style="max-width:620px;background:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 15px 40px rgba(0,0,0,.08);"><!-- HEADER --><tr><td align="center"style="padding:45px 30px;background:linear-gradient(135deg,#ef4444,#dc2626);"><div style="width:85px;height:85px;border-radius:50%;background:rgba(255,255,255,.18);font-size:42px;line-height:85px;">✕</div><h1 style="margin:22px 0 10px;font-size:32px;color:#ffffff;">Order Cancelled</h1><p style="margin:0;font-size:16px;color:#fee2e2;">Your printing order has been cancelled</p></td></tr><!-- BODY --><tr><td style="padding:45px;"><h2 style="margin:0;font-size:26px;color:#111827;">Hello ${customer_name} 👋</h2><p style="margin-top:18px;font-size:16px;line-height:28px;color:#6b7280;">We're sorry to let you know that your UniKart printing order has been cancelled.Please review the cancellation details below.</p><!-- CANCELLED CARD --><table width="100%" cellpadding="0" cellspacing="0"style="margin:30px 0;background:#fef2f2;border-radius:18px;"><tr><td style="padding:25px;"><table width="100%" cellpadding="0" cellspacing="0"><tr><td width="55"><div style="width:45px;height:45px;border-radius:50%;background:#ef4444;color:white;font-size:24px;line-height:45px;text-align:center;">✕</div></td><td><h3 style="margin:0;font-size:18px;color:#b91c1c;">Order Cancelled</h3><p style="margin:8px 0 0;font-size:14px;color:#dc2626;">This order will not be processed for printing.</p></td></tr></table></td></tr></table><!-- ORDER DETAILS --><h3 style="font-size:18px;color:#111827;margin-bottom:15px;">Order Details</h3><table width="100%" cellpadding="12"style="border-collapse:collapse;border:1px solid #e5e7eb;border-radius:14px;"><tr style="background:#f9fafb;"><td style="color:#6b7280;">Order ID</td><td align="right" style="font-weight:600;color:#111827;">${order_id}</td></tr><tr><td style="color:#6b7280;">Status</td><td align="right" style="font-weight:700;color:#ef4444;">CANCELLED</td></tr><tr style="background:#f9fafb;"><td style="color:#6b7280;">Cancellation Reason</td><td align="right" style="font-weight:600;color:#374151;">${cancellation_reason}</td></tr></table><!-- IMPORTANT NOTICE --><table width="100%" cellpadding="0" cellspacing="0"style="margin-top:30px;background:#fff7ed;border-radius:18px;"><tr><td style="padding:25px;"><h3 style="margin:0 0 12px;font-size:18px;color:#9a3412;">⚠️ What This Means</h3><p style="margin:0;font-size:14px;line-height:24px;color:#7c2d12;">Your documents will not be printed as part of this order, and there is no pickup required for this cancelled order.</p></td></tr></table><!-- SUPPORT --><h3 style="margin-top:35px;font-size:18px;color:#111827;">Need Help?</h3><table width="100%" cellpadding="0" cellspacing="0"><tr><td style="font-size:14px;color:#4b5563;padding:8px 0;">✓ Check your Order ID before contacting support</td></tr><tr><td style="font-size:14px;color:#4b5563;padding:8px 0;">✓ Contact UniKart if you believe this cancellation was made in error</td></tr><tr><td style="font-size:14px;color:#4b5563;padding:8px 0;">✓ Our support team can help you with any refund or payment-related questions</td></tr></table><!-- STORE CARD --><table width="100%" cellpadding="0" cellspacing="0"style="margin-top:30px;background:#eff6ff;border-radius:18px;"><tr><td style="padding:25px;"><h3 style="margin:0 0 15px;font-size:18px;color:#1e40af;">📍 UniKart Print Center</h3><p style="margin:5px 0;font-size:15px;color:#374151;line-height:24px;"><strong>Pickup Location</strong><br>${store_address}<br>Contact: ${store_phone}</p></td></tr></table><!-- BUTTON --><div style="text-align:center;margin-top:40px;"><a href="${store_location}"style="display:inline-block;background:#2563eb;color:white;padding:16px 45px;border-radius:12px;font-weight:600;font-size:16px;text-decoration:none;">View UniKart Location →</a></div></td></tr><!-- FOOTER --><tr><td align="center" style="background:#f9fafb;padding:30px;"><h3 style="margin:0;font-size:22px;color:#2563eb;">UniKart</h3><p style="margin:10px 0 0;font-size:13px;color:#9ca3af;">Fast Printing • Easy Pickup • Happy Customers</p><p style="margin:15px 0 0;font-size:12px;color:#9ca3af;">© 2026 UniKart. All Rights Reserved.</p></td></tr></table></td></tr></table></body></html>`;

const mailHost = (process.env.MAIL_HOST || process.env.SMTP_HOST || '').trim();
const mailUser = (process.env.MAIL_USER || process.env.SMTP_USER || '').trim();
const mailPassword = process.env.MAIL_PASSWORD || process.env.SMTP_PASSWORD || '';
const mailPort = Number(process.env.MAIL_PORT || process.env.SMTP_PORT || 587);
const secure = String(process.env.MAIL_SECURE || process.env.SMTP_SECURE || '').toLowerCase() === 'true' || mailPort === 465;

const transporter = nodemailer.createTransport({
  host: mailHost,
  port: mailPort,
  secure,
  auth: {
    user: mailUser,
    pass: mailPassword
  },
  tls: {
    minVersion: process.env.MAIL_VERSION || process.env.SMTP_TLS_MIN_VERSION || 'TLSv1.2'
  }
});

const verifyMailTransport = async () => {
  if (!mailHost || !mailUser || !mailPassword) {
    console.warn('Email transport is not configured; email notifications are disabled.');
    return false;
  }

  await transporter.verify();
  console.log(`🚀 Email transport connected`);
  return true;
};

const QRCode = require('qrcode');

const from = process.env.MAIL_FROM || process.env.SMTP_FROM || process.env.MAIL_USER || process.env.SMTP_USER;

const sendMail = async ({ to, subject, html, attachments }) => {
  if (!to || !from || (!process.env.MAIL_HOST && !process.env.SMTP_HOST)) {
    console.warn('Email skipped because SMTP configuration or recipient is missing.');
    return null;
  }

  return transporter.sendMail({ from, to, subject, html, attachments });
};


const sendCompletionEmail = async (user, order) => {
  const orderNum = order && (order.orderNumber || order.id || order._id) || 'UK-ORDER';
  let qrBuffer = null;
  try {
    qrBuffer = await QRCode.toBuffer(orderNum, { margin: 1, width: 250 });
  } catch (e) {
    console.error('QR email error:', e);
  }

  const attachments = qrBuffer ? [{
    filename: 'qrcode.png',
    content: qrBuffer,
    cid: 'order_qrcode'
  }] : [];

  return sendMail({
    to: user && user.email,
    subject: `UniKart order ${orderNum} is ready`,
    html: completion_mail_content(
      user && user.fullName,
      orderNum,
      process.env.PRINT_PICKUP_TIME || '9:00 AM - 5:00 PM',
      'cid:order_qrcode',
      orderNum,
      process.env.STORE_ADDRESS || 'UniKart Print Center, SGT University',
      process.env.STORE_PHONE || '+91-9319669644',
      process.env.STORE_LOCATION_URL || '#'
    ),
    attachments
  });
};

const sendCancellationEmail = (user, order, reason = 'Cancelled by UniKart') => sendMail({
  to: user && user.email,
  subject: `UniKart order ${(order && (order.orderNumber || order.id || order._id)) || 'UK-ORDER'} cancelled`,
  html: cancellation_mail_content(
    user && user.fullName,
    order && (order.orderNumber || order.id || order._id) || 'UK-ORDER',
    reason,
    process.env.STORE_ADDRESS || '',
    process.env.STORE_PHONE || '',
    process.env.STORE_LOCATION_URL || '#'
  )
});

module.exports = {
  sendCompletionEmail,
  sendCancellationEmail
};
