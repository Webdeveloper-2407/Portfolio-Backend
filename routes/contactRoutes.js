const express = require("express");
const nodemailer = require("nodemailer");
const Contact = require("../models/Contact");

const router = express.Router();

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getGmailConfig() {
  const user = process.env.GMAIL_USER?.trim();

  const appPassword = process.env.GMAIL_APP_PASSWORD
    ?.replace(/\s+/g, "")
    .trim();

  const receiver =
    process.env.CONTACT_RECEIVER_EMAIL?.trim() || user;

  if (!user) {
    throw new Error("GMAIL_USER is missing in .env");
  }

  if (!EMAIL_PATTERN.test(user)) {
    throw new Error("GMAIL_USER is not a valid email address.");
  }

  if (!appPassword) {
    throw new Error("GMAIL_APP_PASSWORD is missing in .env");
  }

  if (appPassword.length !== 16) {
    throw new Error(
      "GMAIL_APP_PASSWORD must be the 16-character Google App Password."
    );
  }

  if (!receiver) {
    throw new Error(
      "CONTACT_RECEIVER_EMAIL or GMAIL_USER must be configured in .env"
    );
  }

  if (!EMAIL_PATTERN.test(receiver)) {
    throw new Error(
      "CONTACT_RECEIVER_EMAIL is not a valid email address."
    );
  }

  return {
    user,
    appPassword,
    receiver,
  };
}

function createTransporter() {
  const { user, appPassword } = getGmailConfig();

  return nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,

    auth: {
      user,
      pass: appPassword,
    },

    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
  });
}

let transporter;

function getTransporter() {
  if (!transporter) {
    transporter = createTransporter();
  }

  return transporter;
}

// Verify Gmail connection when the backend starts.
(async () => {
  try {
    await getTransporter().verify();

    const { user, receiver } = getGmailConfig();

    console.log("Gmail transporter is ready.");
    console.log("Gmail sender:", user);
    console.log("Gmail receiver:", receiver);
  } catch (error) {
    console.error(
      "Gmail transporter error:",
      error instanceof Error ? error.message : error
    );
  }
})();

// POST /api/contact
router.post("/", async (req, res) => {
  const startedAt = Date.now();

  console.log("[CONTACT] POST /api/contact received.");

  try {
    const name = String(req.body?.name || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const subject = String(req.body?.subject || "").trim();
    const message = String(req.body?.message || "").trim();

    // ---------------------------------------------------------
    // STEP 1: Validate incoming contact information.
    // ---------------------------------------------------------

    if (!name || !email || !message) {
      return res.status(400).json({
        success: false,
        saved: false,
        emailSent: false,
        stage: "validation",
        message: "Name, email, and message are required.",
      });
    }

    if (name.length < 2 || name.length > 80) {
      return res.status(400).json({
        success: false,
        saved: false,
        emailSent: false,
        stage: "validation",
        message: "Please enter a valid name.",
      });
    }

    if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
      return res.status(400).json({
        success: false,
        saved: false,
        emailSent: false,
        stage: "validation",
        message: "Please enter a valid email address.",
      });
    }

    if (message.length < 10 || message.length > 5000) {
      return res.status(400).json({
        success: false,
        saved: false,
        emailSent: false,
        stage: "validation",
        message:
          "Your message must be between 10 and 5000 characters.",
      });
    }

    // ---------------------------------------------------------
    // STEP 2: Save the visitor's message to MongoDB FIRST.
    // ---------------------------------------------------------

    let contact;

    try {
      contact = await Contact.create({
        name,
        email,
        subject,
        message,
        emailStatus: "pending",
        emailError: "",
      });

      console.log("[CONTACT] MongoDB save successful:", {
        contactId: String(contact._id),
      });
    } catch (databaseError) {
      const databaseMessage =
        databaseError instanceof Error
          ? databaseError.message
          : "Unknown MongoDB error.";

      console.error("[CONTACT] MongoDB save failed:", databaseMessage);

      return res.status(500).json({
        success: false,
        saved: false,
        emailSent: false,
        stage: "database",
        message:
          "Your message could not be saved. Please try again later.",
        error:
          process.env.NODE_ENV === "production"
            ? undefined
            : databaseMessage,
      });
    }

    // ---------------------------------------------------------
    // STEP 3: Send notification through YOUR Gmail SMTP.
    // ---------------------------------------------------------

    try {
      const { user, receiver } = getGmailConfig();

      const info = await getTransporter().sendMail({
        from: `"Portfolio Contact" <${user}>`,

        to: receiver,

        envelope: {
          from: user,
          to: [receiver],
        },

        replyTo: email,

        subject: `Portfolio Contact: ${
          subject || "New Message"
        }`,

        text: [
          "NEW PORTFOLIO CONTACT MESSAGE",
          "",
          `Name: ${name}`,
          `Visitor Email: ${email}`,
          `Subject: ${subject || "No subject"}`,
          "",
          "Message:",
          message,
          "",
          "Reply to this email to respond directly to the visitor.",
        ].join("\n"),

        html: `
          <div
            style="
              font-family: Arial, Helvetica, sans-serif;
              line-height: 1.6;
              color: #172033;
              max-width: 680px;
            "
          >
            <h2 style="margin:0 0 20px;">
              New Portfolio Contact Message
            </h2>

            <p>
              <strong>Name:</strong>
              ${escapeHtml(name)}
            </p>

            <p>
              <strong>Visitor Email:</strong>
              ${escapeHtml(email)}
            </p>

            <p>
              <strong>Subject:</strong>
              ${escapeHtml(subject || "No subject")}
            </p>

            <p>
              <strong>Message:</strong>
            </p>

            <div
              style="
                padding:16px;
                border:1px solid #d9dfe9;
                border-radius:8px;
                background:#f7f9fc;
              "
            >
              ${escapeHtml(message).replace(/\r?\n/g, "<br />")}
            </div>

            <p style="margin-top:20px;color:#596579;">
              Reply to this email to respond directly to the visitor.
            </p>
          </div>
        `,
      });

      const acceptedRecipients = Array.isArray(info.accepted)
        ? info.accepted.map((address) =>
            String(address).toLowerCase()
          )
        : [];

      const rejectedRecipients = Array.isArray(info.rejected)
        ? info.rejected.map((address) =>
            String(address).toLowerCase()
          )
        : [];

      const receiverAccepted = acceptedRecipients.includes(
        receiver.toLowerCase()
      );

      console.log("[CONTACT] Gmail send result:", {
        messageId: info.messageId,
        envelope: info.envelope,
        accepted: info.accepted,
        rejected: info.rejected,
        response: info.response,
        receiverAccepted,
      });

      // Do not report success if Gmail did not accept the receiver.
      if (!receiverAccepted || rejectedRecipients.length > 0) {
        const rejectedDetails =
          Array.isArray(info.rejectedErrors) &&
          info.rejectedErrors.length
            ? info.rejectedErrors
                .map(
                  (item) =>
                    item?.message || String(item)
                )
                .join("; ")
            : "The Gmail SMTP server did not confirm the receiver as accepted.";

        throw new Error(rejectedDetails);
      }

      // ---------------------------------------------------------
      // STEP 4: Gmail succeeded -> mark MongoDB as sent.
      // ---------------------------------------------------------

      contact.emailStatus = "sent";
      contact.emailMessageId = info.messageId || "";
      contact.emailSentAt = new Date();
      contact.emailError = "";

      await contact.save();

      console.log(
        `[CONTACT] Completed successfully in ${
          Date.now() - startedAt
        }ms.`
      );

      return res.status(201).json({
        success: true,
        saved: true,
        emailSent: true,
        stage: "complete",
        messageId: info.messageId,
        message:
          "Your message has been sent successfully.",
      });
    } catch (emailError) {
      const errorMessage =
        emailError instanceof Error
          ? emailError.message
          : "Unknown Gmail error.";

      console.error("[CONTACT] Gmail sending failed:", {
        message: errorMessage,
        code: emailError?.code,
        responseCode: emailError?.responseCode,
        response: emailError?.response,
      });

      // Keep the contact safely stored in MongoDB.
      try {
        contact.emailStatus = "failed";
        contact.emailError = errorMessage;

        await contact.save();
      } catch (statusSaveError) {
        console.error(
          "[CONTACT] Failed to update MongoDB email status:",
          statusSaveError instanceof Error
            ? statusSaveError.message
            : statusSaveError
        );
      }

      return res.status(502).json({
        success: false,
        saved: true,
        emailSent: false,
        stage: "email",
        message:
          "Your message was saved successfully, but the Gmail notification could not be sent.",
        error:
          process.env.NODE_ENV === "production"
            ? undefined
            : errorMessage,
      });
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : "Unknown server error.";

    console.error(
      "[CONTACT] Unexpected contact submission error:",
      {
        message: errorMessage,
        code: error?.code,
        responseCode: error?.responseCode,
      }
    );

    return res.status(500).json({
      success: false,
      saved: false,
      emailSent: false,
      stage: "server",
      message:
        "Something went wrong while processing your contact request.",
      error:
        process.env.NODE_ENV === "production"
          ? undefined
          : errorMessage,
    });
  }
});

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

module.exports = router;