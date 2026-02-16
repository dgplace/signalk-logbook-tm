#!/usr/bin/env node

const http = require('http');
const { readFile } = require('fs/promises');
const { resolve } = require('path');

/** Default host for the local Swagger server. */
const DEFAULT_HOST = '127.0.0.1';

/** Default port for the local Swagger server. */
const DEFAULT_PORT = 3333;

/** Absolute path to the local OpenAPI YAML file. */
const OPENAPI_YAML_PATH = resolve(__dirname, '..', 'schema', 'openapi.yaml');

/**
 * Write an HTTP response.
 * @param {Object} res HTTP response object.
 * @param {number} statusCode HTTP status code.
 * @param {string} contentType Content-Type header value.
 * @param {string|Buffer} body Response body.
 * @returns {void}
 */
function send(res, statusCode, contentType, body) {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

/**
 * Build the Swagger UI HTML page.
 * @returns {string} HTML document content.
 */
function getSwaggerHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>signalk-cruisereport API</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  <style>
    html, body { margin: 0; padding: 0; background: #fafafa; }
    #swagger-ui { max-width: 1200px; margin: 0 auto; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: '/openapi.yaml',
      dom_id: '#swagger-ui',
      deepLinking: true,
      defaultModelsExpandDepth: 1
    });
  </script>
</body>
</html>`;
}

/**
 * Route incoming HTTP requests.
 * @param {Object} req HTTP request object.
 * @param {Object} res HTTP response object.
 * @returns {Promise<void>} Completion promise.
 */
async function routeRequest(req, res) {
  const requestUrl = new URL(req.url, `http://${DEFAULT_HOST}`);

  if (requestUrl.pathname === '/') {
    send(res, 200, 'text/html; charset=utf-8', getSwaggerHtml());
    return;
  }

  if (requestUrl.pathname === '/openapi.yaml') {
    try {
      const yaml = await readFile(OPENAPI_YAML_PATH, 'utf-8');
      send(res, 200, 'application/yaml; charset=utf-8', yaml);
      return;
    } catch (error) {
      send(res, 500, 'application/json; charset=utf-8', JSON.stringify({
        error: 'Unable to read OpenAPI file',
        message: error.message,
      }));
      return;
    }
  }

  if (requestUrl.pathname === '/health') {
    send(res, 200, 'application/json; charset=utf-8', JSON.stringify({ ok: true }));
    return;
  }

  send(res, 404, 'application/json; charset=utf-8', JSON.stringify({
    error: 'Not Found',
  }));
}

/**
 * Start the local Swagger UI server.
 * @returns {void}
 */
function startServer() {
  const host = process.env.SWAGGER_HOST || DEFAULT_HOST;
  const port = Number(process.env.SWAGGER_PORT || DEFAULT_PORT);

  const server = http.createServer((req, res) => {
    routeRequest(req, res).catch((error) => {
      send(res, 500, 'application/json; charset=utf-8', JSON.stringify({
        error: 'Internal Server Error',
        message: error.message,
      }));
    });
  });

  server.listen(port, host, () => {
    // eslint-disable-next-line no-console
    console.log(`Swagger UI available at http://${host}:${port}`);
    // eslint-disable-next-line no-console
    console.log('Press Ctrl+C to stop.');
  });
}

startServer();
