/**
 * Alert Notification Service
 * Handles sending notifications for various alert types (email, webhook, logging)
 */
import nodemailer from 'nodemailer';

// Email configuration from environment
const emailConfig = {
  host: process.env.SMTP_HOST || 'localhost',
  port: process.env.SMTP_PORT || 587,
  secure: process.env.SMTP_SECURE === 'true',
  auth: process.env.SMTP_USER ? {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  } : null
};

let transporter = null;

// Initialize email transporter if configured
if (emailConfig.auth) {
  transporter = nodemailer.createTransport(emailConfig);
}

// List of alert subscribers (can be populated from database)
const defaultAlertSubscribers = {
  'site_offline': process.env.ALERT_EMAIL_OFFLINE?.split(',').map(s => s.trim()).filter(Boolean) || [],
  'battery_critical': process.env.ALERT_EMAIL_BATTERY?.split(',').map(s => s.trim()).filter(Boolean) || [],
  'all': process.env.ALERT_EMAIL_ALL?.split(',').map(s => s.trim()).filter(Boolean) || []
};

const alertSubscribers = {
  'site_offline': [...defaultAlertSubscribers.site_offline],
  'battery_critical': [...defaultAlertSubscribers.battery_critical],
  'all': [...defaultAlertSubscribers.all]
};

/**
 * Send alert notification
 * @param {string} alertType - Type of alert (site_offline, battery_critical)
 * @param {string} severity - Severity level (critical, warning, info)
 * @param {object} alertData - Alert data with site_name, message, etc.
 */
export async function sendAlertNotification(alertType, severity, alertData) {
  try {
    // Log alert to console
    console.log(`[${alertType.toUpperCase()}] ${severity.toUpperCase()}: ${alertData.message}`);

    // Send email if configured
    if (transporter && alertSubscribers[alertType]?.length > 0) {
      await sendEmailNotification(alertType, severity, alertData);
    }

    // Send webhook if configured
    if (process.env.WEBHOOK_URL) {
      await sendWebhookNotification(alertType, severity, alertData);
    }

    // Log to file/database (optional)
    await logAlertEvent(alertType, severity, alertData);

  } catch (err) {
    console.error('Error sending alert notification:', err);
  }
}

/**
 * Send email notification
 */
async function sendEmailNotification(alertType, severity, alertData) {
  try {
    const recipients = [
      ...alertSubscribers[alertType],
      ...alertSubscribers['all']
    ];

    if (recipients.length === 0) {
      return;
    }

    const emailSubject = `[${severity.toUpperCase()}] ${alertType === 'site_offline' ? 'Site Offline' : 'Battery Critical'} - ${alertData.site_name}`;
    const emailBody = generateEmailBody(alertType, severity, alertData);

    const mailOptions = {
      from: process.env.SMTP_FROM || 'alerts@iotplatform.local',
      to: [...new Set(recipients)].join(', '),
      subject: emailSubject,
      html: emailBody
    };

    await transporter.sendMail(mailOptions);
    console.log(`Email notification sent for ${alertType} to ${recipients.length} recipients`);

  } catch (err) {
    console.error('Error sending email notification:', err);
  }
}

/**
 * Send webhook notification
 */
async function sendWebhookNotification(alertType, severity, alertData) {
  try {
    const payload = {
      type: alertType,
      severity: severity,
      timestamp: new Date().toISOString(),
      siteId: alertData.site_id,
      siteName: alertData.site_name,
      message: alertData.message,
      deviceId: alertData.device_id,
      oem: alertData.oem
    };

    const response = await fetch(process.env.WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.WEBHOOK_SECRET || ''}`
      },
      body: JSON.stringify(payload),
      timeout: 5000
    });

    if (!response.ok) {
      console.warn(`Webhook returned status ${response.status}`);
    } else {
      console.log(`Webhook notification sent for ${alertType}`);
    }

  } catch (err) {
    console.error('Error sending webhook notification:', err);
  }
}

/**
 * Log alert event (can be extended to store in database)
 */
async function logAlertEvent(alertType, severity, alertData) {
  try {
    // Future: Store in database or log file
    // For now, just logging to console
  } catch (err) {
    console.error('Error logging alert event:', err);
  }
}

/**
 * Generate HTML email body
 */
function generateEmailBody(alertType, severity, alertData) {
  const severityColor = severity === 'critical' ? '#dc3545' : '#ffc107';
  const alertTitle = alertType === 'site_offline' ? 'Site Offline Alert' : 'Battery Critical Alert';

  return `
    <html>
      <body style="font-family: Arial, sans-serif; line-height: 1.6;">
        <div style="border-left: 4px solid ${severityColor}; padding: 20px; background-color: #f9f9f9;">
          <h2 style="color: ${severityColor}; margin-top: 0;">${alertTitle}</h2>
          
          <div style="background-color: white; padding: 15px; border-radius: 5px; margin: 15px 0;">
            <p><strong>Severity:</strong> <span style="color: ${severityColor}; font-weight: bold;">${severity.toUpperCase()}</span></p>
            <p><strong>Site:</strong> ${alertData.site_name}</p>
            ${alertData.device_id ? `<p><strong>Device:</strong> ${alertData.device_id}</p>` : ''}
            ${alertData.oem ? `<p><strong>OEM:</strong> ${alertData.oem}</p>` : ''}
            <p><strong>Message:</strong> ${alertData.message}</p>
            <p><strong>Time:</strong> ${new Date().toISOString()}</p>
          </div>

          <div style="background-color: #f0f0f0; padding: 10px; border-radius: 5px; margin: 15px 0;">
            <p style="margin: 0; font-size: 12px; color: #666;">
              ${alertType === 'site_offline' ? 
                'The site has not sent any telemetry data for over 1 hour. Please check the connection and device status.' :
                'Battery voltage has dropped below the critical threshold (20%). Immediate action may be required.'}
            </p>
          </div>

          <p style="font-size: 12px; color: #999;">
            This is an automated alert from your IoT Monitoring Platform.
          </p>
        </div>
      </body>
    </html>
  `;
}

/**
 * Update alert subscribers from database
 * @param {Pool} pool - Database connection pool
 */
export async function loadAlertSubscribers(pool) {
  try {
    const result = await pool.query(`
      SELECT alert_type, email
      FROM alert_subscribers
      WHERE is_active = true
    `);

// Reset subscribers to defaults from environment
  Object.keys(alertSubscribers).forEach(key => {
    alertSubscribers[key] = [...defaultAlertSubscribers[key]];
    });

    // Populate from database
    for (const row of result.rows) {
      if (alertSubscribers[row.alert_type]) {
        alertSubscribers[row.alert_type].push(row.email);
      }
      alertSubscribers['all'].push(row.email);
    }

    alertSubscribers['all'] = [...new Set(alertSubscribers['all'])];
    console.log('Alert subscribers loaded from database and merged with environment defaults');

  } catch (err) {
    console.error('Error loading alert subscribers:', err);
  }
}

/**
 * Get current alert subscribers
 */
export function getAlertSubscribers() {
  return alertSubscribers;
}
