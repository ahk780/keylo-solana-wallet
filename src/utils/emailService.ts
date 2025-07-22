import nodemailer from 'nodemailer';
import { smtp } from '../config';

interface SendOTPEmailParams {
  email: string;
  otp: string;
  type: 'login' | 'register' | 'withdraw' | 'security';
}

class EmailService {
  private transporter: nodemailer.Transporter | null = null;

  constructor() {
    this.initializeTransporter();
  }

  private initializeTransporter(): void {
    try {
      this.transporter = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        auth: {
          user: smtp.user,
          pass: smtp.pass
        }
      });
    } catch (error) {
      console.error('Failed to initialize email transporter:', error);
    }
  }

  private getEmailTemplate(type: string, otp: string): { subject: string; html: string } {
    const baseTemplate = {
      register: {
        subject: 'Complete Your Registration - OTP Verification',
        action: 'complete your registration'
      },
      login: {
        subject: 'Login Verification Code',
        action: 'login to your account'
      },
      withdraw: {
        subject: 'Withdrawal Verification Code',
        action: 'confirm your withdrawal'
      },
      security: {
        subject: 'Security Verification Code',
        action: 'verify your identity'
      }
    };

    const template = baseTemplate[type as keyof typeof baseTemplate] || baseTemplate.login;

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${template.subject}</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background-color: #f5f5f5; }
            .container { max-width: 600px; margin: 0 auto; background: white; padding: 40px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            .header { text-align: center; margin-bottom: 30px; }
            .logo { font-size: 24px; font-weight: bold; color: #333; }
            .otp-box { background: #f8f9fa; border: 2px dashed #007bff; padding: 20px; text-align: center; margin: 30px 0; border-radius: 8px; }
            .otp-code { font-size: 32px; font-weight: bold; color: #007bff; letter-spacing: 5px; }
            .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #666; text-align: center; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <div class="logo">Keylo</div>
            </div>
            
            <h2>Verification Code</h2>
            <p>Use the following verification code to ${template.action}:</p>
            
            <div class="otp-box">
              <div class="otp-code">${otp}</div>
            </div>
            
            <p><strong>Important:</strong></p>
            <ul>
              <li>This code expires in 5 minutes</li>
              <li>Do not share this code with anyone</li>
              <li>If you didn't request this code, please ignore this email</li>
            </ul>
            
            <div class="footer">
              <p>This email was sent by Keylo. If you have any questions, please contact our support team.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    return { subject: template.subject, html };
  }

  public async sendOTPEmail({ email, otp, type }: SendOTPEmailParams): Promise<boolean> {
    if (!this.transporter) {
      console.error('Email transporter not initialized');
      return false;
    }

    try {
      const { subject, html } = this.getEmailTemplate(type, otp);

      const mailOptions = {
        from: `"${smtp.fromName}" <${smtp.fromEmail}>`,
        to: email,
        subject: subject,
        html: html
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log('OTP email sent successfully:', result.messageId);
      return true;
    } catch (error) {
      console.error('Failed to send OTP email:', error);
      return false;
    }
  }

  public async verifyConnection(): Promise<boolean> {
    if (!this.transporter) {
      return false;
    }

    try {
      await this.transporter.verify();
      return true;
    } catch (error) {
      console.error('Email service connection failed:', error);
      return false;
    }
  }
}

export const emailService = new EmailService(); 