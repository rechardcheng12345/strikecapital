import { env } from '../config/env.js';
import logger from '../config/logger.js';

const SENDER_EMAIL = process.env.SENDER_EMAIL || 'noreply@strikecapital.com';
const SENDER_NAME = 'StrikeCapital';

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
}

class EmailService {
  private async sendEmail(options: EmailOptions): Promise<void> {
    // Placeholder: implement with your preferred email provider
    // (Nodemailer, SendGrid, Enginemailer, etc.)
    console.log(`[Email] Would send to ${options.to}: ${options.subject}`);
    logger.info(`Email queued: ${options.subject} -> ${options.to}`);
  }

  async sendPasswordReset(email: string, resetToken: string): Promise<void> {
    const resetUrl = `${env.frontendUrl}/reset-password?token=${resetToken}`;
    await this.sendEmail({
      to: email,
      subject: 'Password Reset - StrikeCapital',
      html: `
        <h2>Password Reset</h2>
        <p>You requested a password reset. Click below to set a new password:</p>
        <p><a href="${resetUrl}" style="background-color: #F06010; color: white; padding: 10px 20px; text-decoration: none;">Reset Password</a></p>
        <p>This link expires in 1 hour.</p>
        <p>If you didn't request this, ignore this email.</p>
      `,
    });
  }

  async sendWelcomeInvestor(email: string, fullName: string, tempPassword: string): Promise<void> {
    await this.sendEmail({
      to: email,
      subject: 'Welcome to StrikeCapital',
      html: `
        <h2>Welcome to StrikeCapital, ${fullName}!</h2>
        <p>Your investor account has been created.</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Temporary Password:</strong> ${tempPassword}</p>
        <p>Please login and change your password immediately.</p>
        <p><a href="${env.frontendUrl}/login" style="background-color: #F06010; color: white; padding: 10px 20px; text-decoration: none;">Login Now</a></p>
      `,
    });
  }

  async sendPositionAlert(email: string, ticker: string, strikePrice: number, message: string): Promise<void> {
    await this.sendEmail({
      to: email,
      subject: `Position Alert: ${ticker} $${strikePrice} Put`,
      html: `
        <h2>Position Alert</h2>
        <p><strong>${ticker} $${strikePrice} Put</strong></p>
        <p>${message}</p>
        <p><a href="${env.frontendUrl}" style="background-color: #0D2654; color: white; padding: 10px 20px; text-decoration: none;">View Dashboard</a></p>
      `,
    });
  }

  async sendExpiryReminder(email: string, ticker: string, strikePrice: number, daysUntilExpiry: number): Promise<void> {
    await this.sendEmail({
      to: email,
      subject: `Expiry Reminder: ${ticker} $${strikePrice} Put — ${daysUntilExpiry} day(s)`,
      html: `
        <h2>Expiry Reminder</h2>
        <p>The position <strong>${ticker} $${strikePrice} Put</strong> expires in <strong>${daysUntilExpiry} day(s)</strong>.</p>
        <p><a href="${env.frontendUrl}" style="background-color: #F06010; color: white; padding: 10px 20px; text-decoration: none;">View Position</a></p>
      `,
    });
  }

  async sendTestEmail(email: string): Promise<void> {
    await this.sendEmail({
      to: email,
      subject: 'Test Email from StrikeCapital',
      html: `
        <h2>Test Email</h2>
        <p>This is a test email from the StrikeCapital system.</p>
        <p>If you received this, email delivery is working correctly.</p>
      `,
    });
  }
}

export const emailService = new EmailService();
