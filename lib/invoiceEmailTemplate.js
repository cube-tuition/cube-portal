/**
 * Invoice email template
 *
 * Available variables (automatically substituted):
 *   {{guardian}}   — guardian's first name
 *   {{invNo}}      — invoice number (e.g. CUBE-2025-T1-001)
 *   {{amount}}     — total amount due (e.g. $450.00)
 *   {{dueDate}}    — due date (e.g. 15 Feb 2025)
 */

export const INVOICE_EMAIL_TEMPLATE = `Dear {{guardian}},

Please find the invoice {{invNo}} attached.

Amount due: {{amount}}
Due by: {{dueDate}}

How to pay: Bank transfer
Account name: CUBE Tuition
BSB: 067 873
Account number: 1616 0459
Description/Reference: {{invNo}}

Terms & Conditions available at: https://www.cubetuition.com.au/

Please note that the two-week trial period is included in the total fee. This amount covers the trial and the subsequent sessions for the full term.

If you have any questions or need instalments, please do not hesitate to contact us.

Kind regards,

--
CUBE Tuition
0405 369 682
admin@cubetuition.com.au
Suite 602 / 2 Help Street Chatswood`
