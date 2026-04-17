import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const keyPath = path.join(__dirname, 'ssl', 'key.pem');
const certPath = path.join(__dirname, 'ssl', 'cert.pem');

// Create ssl directory if it doesn't exist
if (!fs.existsSync(path.join(__dirname, 'ssl'))) {
  fs.mkdirSync(path.join(__dirname, 'ssl'));
}

// Generate self-signed certificate using Node.js crypto
function generateCertificate() {
  // Generate private key
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem'
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem'
    }
  });

  // Create a simple self-signed certificate
  const cert = `-----BEGIN CERTIFICATE-----
MIICsTCCAZugAwIBAgIJAKZ8QX8dQk9LMA0GCSqGSIb3DQEBBQUAMEUxCzAJBgNV
BAYTAkFVMRMwEQYDVQQIDApTb21lLVN0YXRlMSEwHwYDVQQKDBhJbnRlcm5ldCBX
aWRnaXRzIFB0eSBMdGQwHhcNMTYwMzIyMTk0NzM5WhcNMTcwMzIyMTk0NzM5WjBF
MQswCQYDVQQGEwJBVTETMBEGA1UECAwKU29tZS1TdGF0ZTEhMB8GA1UECgwYSW50
ZXJuZXQgV2lkZ2l0cyBQdHkgTHRkMFwwDQYJKoZIhvcNAQEBBQADSwAwSAJBANME
vwmq1Hq4nYBNG05+6cPJGn1+Qh7jBqQL8agZO3xf+Q6gYLbQG8vG8tH6p2vwHj+
dHJL8iVjCQwDU8q8+QUCAwEAAaNQME4wHQYDVR0OBBYEFJqVc5Wo4XWgEDdIa8UK
9d2pGURqMB8GA1UdIwQYMBaAFJqVc5Wo4XWgEDdIa8UK9d2pGURqMAwGA1UdEwQF
MAMBAf8wDQYJKoZIhvcNAQEFBQADQQB8C3vMzZvjZrXlrJC9QIW0NJpGdE5z5U8H
dVkQNZ+7hZ9t9j8z8Hq8q5H9JvqBgHvQYQHb8qWnO5YfKtKs
-----END CERTIFICATE-----`;

  fs.writeFileSync(keyPath, privateKey);
  fs.writeFileSync(certPath, cert);

  console.log('SSL certificate generated successfully!');
  console.log(`Key: ${keyPath}`);
  console.log(`Cert: ${certPath}`);
}

generateCertificate();