#!/usr/bin/env node
// render-email-preview.mjs — dump the tailored HTML email to a file for review.
import { bodyToHtml } from './email-html.mjs';
import { writeFileSync } from 'fs';

const body = process.argv[2] || `Dear Hiring Team,

I am writing to apply for the Junior Software Developer position at Geekay Infotech. I hold a B.E. in Information Technology from Mumbai University and have hands-on experience with Java, Spring Boot, React.js, and PostgreSQL.

During my internship at Qyuki Digital Media, I built production applications using Java/Spring Boot and React, including REST API integrations with secure authentication. I also developed Career Grid, a job platform with Spring Boot microservices deployed on AWS EC2, and Fair Pay Solution, a full-stack loan settlement platform.

Key highlights:
- Fair Pay Solution (fairpaysolution.com) — loan settlement platform with Supabase, Razorpay, Google OAuth, RBAC, and cloud deployment
- Career Grid — job portal with Spring Boot microservices, 2FA authentication, and AWS EC2/Route 53 deployment
- Fine-tuned AI models (Gemma Vision, Index TTS2) and automated CI/CD pipelines via n8n
- B.E. in Information Technology from University of Mumbai (2024)

I am based in Kalyan and can commute to Byculla. I look forward to the opportunity to contribute to Geekay Infotech's team.

Best regards,
Jayesh Singh
+91-7821816193`;

const html = bodyToHtml(body, process.argv[3] || 'Geekay Infotech');
writeFileSync('/tmp/email-preview.html', html, 'utf-8');
console.log('wrote /tmp/email-preview.html bytes=' + Buffer.byteLength(html));