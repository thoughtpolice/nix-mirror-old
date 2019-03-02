// main.js: Nix Binary caches, via CloudFlare Workers and S3
// Copyright (c) Austin Seipp 2019

/// Author:     Austin Seipp <aseipp [@at] pobox [.dot] com>
/// Maintainer: "
/// Source:     https://github.com/thoughtpolice/nix-mirror
/// Version:    @GIT_VERSION@

/// License:

  // Permission is hereby granted, free of charge, to any person obtaining a
  // copy of this software and associated documentation files (the "Software"),
  // to deal in the Software without restriction, including without limitation
  // the rights to use, copy, modify, merge, publish, distribute, sublicense,
  // and/or sell copies of the Software, and to permit persons to whom the
  // Software is furnished to do so, subject to the following conditions:
  //
  // The above copyright notice and this permission notice shall be included in
  // all copies or substantial portions of the Software.
  //
  // THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  // IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  // FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  // AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
  // LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
  // FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
  // DEALINGS IN THE SOFTWARE.
  //
  // [ MIT License: https://choosealicense.com/licenses/mit/ ]

/// Commentary:

  // This script is a CloudFlare Worker that proxies connections from the
  // CloudFlare CDN to some S3-compatible backend object storage service.
  // The intention of this script is to essentially provide a "serverless"
  // globally distributed application for mirroring, hosting, or serving
  // Nix (https://nixos.org) binary caches that doesn't require hosting large
  // amounts of infrastructure. Rather, requests are routed 'from the edge'
  // of CloudFlare's network directly to backend object storage.
  //
  // This worker can be deployed to any subdomain of a particular top-level
  // DNS zone; traditionally something like 'cache.zone.name'
  //
  // This script is "s3 compatible" because it is designed to read from
  // _private_ S3 buckets using read-capable API keys. The reasoning for this
  // is mostly one of isolation (public buckets are a bad policy!), but also
  // performance and cost. Due to CloudFlare having bandwidth and peering
  // agreements with various cloud storage providers such as BackBlaze and
  // Wasabi, connections from CloudFlare come at lower cost and have
  // better performance. In the case of Backblaze and Wasabi in particular,
  // these peering agreements mean data transfer is free. Therefore isolating
  // the buckets from any non-peered networks is superior in nearly every way:
  // it reduces costs down to object storage and nothing more. (Of course,
  // this script could still be used with e.g. Amazon S3 or another provider,
  // such as Digital Ocean, DreamHost Objects, etc.)
  //
  // This script does NOT handle any form of upload capability, and therefore
  // you MUST configure it with READ ONLY S3 KEYS. Preferably, these should
  // be scoped directly to a single bucket.

/// Configuration:

  // Lorem ipsum...

/// TODO:

  // - A/B for multi-regional buckets would be nice
  //   - multi-name endpoints per-bucket would be nice, too, as well as global
  // - Workers KV can be used for config/auth/multi-bucket experiments?
  //   - It would be really nice to use it for logging/configuration, at
  //     least, allowing online ops tuning...
  // - Some artifacts *could* be cached, but we'd need to match filetypes to
  //   content types and set the appropriate headers. (CloudFlare normally will
  //   auto-cache certain URIs like .html files, but I do not believe this is
  //   the case when Workers are generating responses.)
  // - We could use brotli ('br') for static HTML pages, but this seems to
  //   be buggy in the current version of Workers(?)

/* -------------------------------------------------------------------------- */
/* -- Zone/S3 user configuration -------------------------------------------- */

// The store path that objects within this cache should be installed/rooted
// to. You SHOULD NOT need to ever change this, but it may be useful if
// you are using a custom store path.
const CACHE_STORE_PATH = '/nix/store'

// The relative priority of the Nix cache when considered among a set of
// alternatives (including other mirrors). Higher numbers indicate higher
// priority, i.e. this cache should be attempted first. The upstream
// cache.nixos.org service has a priority of 40.
const CACHE_PRIORITY = 30

// Whether or not to log all HTTP requests, and cache responses/NAR object
// information, to a 3rd party server. If this is enabled, POST requests
// will be published to a specified LOGGING_ENDPOINT, and analytics dashboards
// will  (presumably) be available at a specified LOGGING_ANALYTICS URL.
const LOGGING_ENABLE = true

// The URL to submit CDN logs to. Logs will be submitted as POST requests
// containing application/json content-type bodies. It is assumed this is not
// in any way hosted by the worker (i.e. the worker does not have routes
// covering any of these paths)
const LOGGING_ENDPOINT = `ingest.${CACHE_DOMAIN}`

// The URL to view CDN logging analytics at. It is assumed this is not in any
// way hosted by the worker (i.e. the worker does not have routes covering any
// of these paths)
const LOGGING_ANALYTICS = `analytics.${CACHE_DOMAIN}`

/* -------------------------------------------------------------------------- */
/* -- Debug configuration --------------------------------------------------- */

// The top-level zone name for your domain that will host the cache. This will
// be combined with the CACHE_SUBDOMAIN in order to get the full cache URL.
//
// const CACHE_DOMAIN = 'cowsay.pw'

// The subdomain (within the top-level zone) that will host the cache. All
// requests to this subdomain will be programatically routed to some backend
// object store.
//
// const CACHE_SUBDOMAIN = 'cache'

// The S3-compatible API endpoint to use. For non-AWS providers, this is
// normally some region/zone-specific endpoint (S3 itself has globally
// available regions you can use)
//
// const S3_API_ENDPOINT = 's3.wasabisys.com'

// The name of the S3 bucket, queryable at the given S3_API_ENDPOINT, that
// is assumed to host all objects in the Nix cache. Subdirectories are not
// (currently) supported, i.e. it is assumed this bucket is empty at first and
// has no other uses than as a Nix cache, and all objects are uploaded directly
// into the top-level directory.
//
// It is also assumed that this bucket is not publically available, and that
// S3 keys are the only method of accessing objects, though this is not checked
// or verified.
//
//const S3_BUCKET = '...'

// The S3 Access Key that is used to access the S3 bucket available at the
// specified API endpoint.
//
// This access key MUST HAVE read permissions, but does not need to have any
// write permissions.
//
//const S3_ACCESS_KEY = '...'

// The S3 Secret Key -- an ASCII-encoded binary blob that is, in actuality,
// a private key for signing things with HMAC-SHA-1 -- that is used to access
// the S3 bucket available at the specified API endpoint. GET requests to the
// underlying object store are signed using this private key, in an S3 "v4"
// compatible API format. Therefore, any S3 storage system supporting "v4" GET
// requests should be compatible with this script.
//
// This access key MUST HAVE read permissions, but does not need to have any
// write permissions.
//
//const S3_SECRET_KEY = '...'

// The HTTP Authentication parameters for POSTing data to ClickHouse. The
// specified credentials MUST be specified in the form 'user:password', which
// is the underlying format used by HTTP Basic Authentication.
//
// The ClickHouse user specified MUST have write permissions so that data
// can be inserted into the specified tables.
//
//const CLICKHOUSE_LOGIN = '...'

// The Database that the ClickHouse user will write to.
//
//const CLICKHOUSE_DATABASE = '...'

/* -------------------------------------------------------------------------- */
/* -- No more configuration beyond this point ------------------------------- */

// Developer switches
const DEBUG = false // NOTE: should _ONLY_ be set in the dev console!

// Register the top-level fetch handler for this domain
addEventListener('fetch', e => e.respondWith(logAndForwardRequest(e)))

/**
 * Takes a request, forwards it to the top-level handler, while recording
 * the request/response values, and forwarding them to the underlying
 * ClickHouse database, via HTTPS. Logs are pushed in JSON format to the
 * HTTP endpoint using JSONEachRow format.
 * 
 * @param {Event} event The incoming event, including the request
 * @return {Response} The response from the backend service
 */
async function logAndForwardRequest(event) {
  const { request } = event
  const url = new URL(request.url)
  const host = url.host
  let subdomain = host.substring(0, host.indexOf('.'))

  // hack: just remap non-www root zone requests to the www subdomain
  if (host === CACHE_DOMAIN) subdomain = 'www'
  
  // bail fast if it's not the cache endpoint, or logging is disabled
  const response = await handle(request, subdomain)
  if (!LOGGING_ENABLE || (subdomain !== CACHE_SUBDOMAIN)) return response

  // build the JSON payload and query insert endpoint
  const insertComponent = 'query=' + encodeURIComponent('INSERT INTO logs FORMAT JSONEachRow')
  const logEndpoint     = `https://${LOGGING_ENDPOINT}/?database=${CLICKHOUSE_DATABASE}&${insertComponent}`
  const logRequest = {
    method: "POST",
    headers: {
      'Content-Type'  : 'application/json',
      'Authorization' : 'Basic ' + btoa(CLICKHOUSE_LOGIN)
    },
    body: JSON.stringify({
      method : request.method,
      url    : url.pathname,
      host   : request.headers.get("host"),
      ray    : request.headers.get("cf-ray"),
      status : response.status,
    }),
  }

  // execute the log POST, and register the result Promise with the worker event
  // loop using .waitUntil -- this will allow execution to continue and the 
  // client response to be returned immediately, while ensuring the worker 
  // runtime waits until the POST is completed -- otherwise, if the response
  // returns too quickly, the POST will not complete, losing a log insert
  let logResponse = fetch(logEndpoint, logRequest)
  event.waitUntil(logResponse)
  if (DEBUG) {
    // in the DEBUG case, await the result too, in order to see the status code
    let logResult = await logResponse
    console.log(logEndpoint, logRequest)
    console.log('Logging endpoint response:', logResult.status)
  }

  // finished
  return response
}

/**
 * The /nix-cache-info directive for this binary cache -- it's generated on the
 * fly, and not served from any object storage.
 */
const nixCacheInfo = `StoreDir: ${CACHE_STORE_PATH}
WantsMassQuery: 1
Priority: ${CACHE_PRIORITY}
`

/* -------------------------------------------------------------------------- */

/**
 * Returns a compressed (gzip) HTTP page with the given status code and
 * static content.
 * 
 * @param {Int} status HTTP status code
 * @param {String} statusText
 * @param headers pre-canned headers to add to the response
 * @param {String} static content
 * @return {Response} a response containing a static HTTP page
 */
async function staticPage(status, statusText, headers, content) {
  let defaultHeaders = {
    'content-type'     : 'text/html; charset=utf-8',
    'content-encoding' : 'gzip',
  }

  // merge user headers *into* the default headers, so defaults can be
  // overridden
  const allHeaders = {...defaultHeaders, ...headers}

  // TODO: maybe get rid of statusText?
  return new Response(content, {
    status: status,
    statusText: statusText,
    headers: allHeaders,
  })
}

/* -------------------------------------------------------------------------- */

class S3 {
  constructor(endpoint, accessKey, secretKey) {
    this.endpoint = endpoint
    this.accessKey = accessKey
    this.secretKey = secretKey
  }

  /**
   * Convert some HTTP request for a given URL pathname into a signed S3
   * request -- one that requests the given object represented by the path,
   * located inside a specific bucket. This function can be thought of as
   * a simple "forwarder" from ordinary HTTP requests to S3 object requests
   * for any private bucket.
   * 
   * @param {String} bucket the bucket to access
   * @param {Request} req the original HTTP request, containing the desired path
   * @return {Response} a response from the S3 object store
   */
  async signedRequest(bucket, req) {
    let url  = new URL(req.url)

    // fast path: /nix-cache-info can be customized, so don't serve the object
    // version (even though the tools will upload it)
    if (url.pathname === '/nix-cache-info')
      return staticPage(200, "OK", { 'content-type' : 'text/plain; charset=utf-8' }, nixCacheInfo)

    // returns the current time in "quasi-ISO 8601" format expected for signed
    // S3 requests -- because, apparently, Amazon was just too damn cool to
    // use ISO 8601.
    let date = new Date()
      .toISOString()
      .replace(/[:\-]|\.\d{3}/g, '')
      .substr(0, 17)

    // construct signed GET blob
    let pathname = `${bucket}${url.pathname}`
    let getRequest = new TextEncoder().encode(`GET\n\n\n${date}\n/${pathname}`)

    // sign, decode from arraybuffer
    const blob = await crypto.subtle.sign("HMAC", S3_SECRET_KEY, getRequest)
    const signature = btoa(String.fromCharCode(...new Uint8Array(blob)))

    // build request
    let auth = 'AWS ' + this.accessKey + ':' + signature
    let s3path = `https://${this.endpoint}/${pathname}`
    let requestSettings = {
      method: 'GET',
      headers: {
        'Host'          : this.endpoint,
        'Date'          : date,
        'Authorization' : auth,
      }
    }

    if (DEBUG) {
      // dump a curl command that can request an object. only meaningful
      // in the developer console, where you can see it.
      console.log(`curl -H "Host: ${requestSettings.headers['Host']}"`,
                  `-H "Date: ${requestSettings.headers['Date']}"`,
                  `-H "Authorization: ${requestSettings.headers['Authorization']}"`,
                  s3path)
    }

    // fire
    return fetch(s3path, new Request(s3path, requestSettings))
  }
}

/* -------------------------------------------------------------------------- */
/* -- Top-level request router ---------------------------------------------- */

/**
 * Returns an invalid 404 page for any non-routeable URLs.
 * 
 * @return {Response} 404 response
 */
async function invalidPage() {
  return staticPage(404, "Invalid Page", {}, "Invalid page requested");
}

/**
 * Check if the ClickHouse server is online, by issuing a SELECT as the
 * chosen user.
 *
 * @return {Response} HTTP response from ClickHouse
 */
function checkClickHouse() {
  // build the JSON payload and query insert endpoint
  const insertComponent = 'query=' + encodeURIComponent('SELECT 1')
  const pingEndpoint    = `https://${LOGGING_ENDPOINT}/?database=${CLICKHOUSE_DATABASE}&${insertComponent}`
  const pingRequest = {
    method: "GET",
    headers: {
      'Content-Type'  : 'application/json',
      'Authorization' : 'Basic ' + btoa(CLICKHOUSE_LOGIN)
    },
  }
  return fetch(pingEndpoint, pingRequest)
}

/**
 * Returns a nice and useful support/help landing page, for use as the top
 * level domain/www subdomain route. This makes it clear to users what this
 * service does, and how it does it.
 * 
 * @param {Request} Incoming HTTP request
 * @return {Response} 200 HTML response
 */
async function landingPage(s3, origRequest) {
  let workerVersion = "@GIT_VERSION@"

  let origHeaders = origRequest.headers
  let rayid = origHeaders.get('cf-ray')
  let cfip  = origHeaders.get('cf-connecting-ip')
  let cfcnt = origHeaders.get('cf-ipcountry')

  let facts =
    [ "Cats have worse STA than Dragons, but higher INT."
    , "Cats are traditionally classified as non-solid objects."
    , "Cats are allowed to taunt Happy Fun Ball. You are not."
    , "Cats get along extremely well with cows, especially talking ones."
    ]
  let fact = facts[Math.floor(Math.random() * facts.length)]

  // this ping will hit the '/' URL, to test if the bucket is available
  let s3ping = await s3.signedRequest(S3_BUCKET, origRequest)
  if (DEBUG) console.log('S3 ping response: ', s3ping.status)
  // and also, check ClickHouse
  let chping = await checkClickHouse();
  if (DEBUG) console.log('ClickHouse ping response: ', chping.status)

  const getStatus = (resp) => {
    switch (resp.status) {
      case 200: return [ true,  "<strong>online</strong>",  "&#x1F4AF;" ]
      default:  return [ false, "<strong>offline</strong>", "&#x274C;"  ]
    }
  }

  let s3stat = getStatus(s3ping)
  let chstat = getStatus(chping)

  // do some title/error customization
  let statusText  = ""
  let titleText   = "is online"
  let statusEmoji = "&#x1F4AF;"
  if (!s3stat[0] || !chstat[0]) {
    statusText = `<hr class="my-4"><p>This mirror seems to be malfunctioning. Please contact the administrators.</p><hr class="myr-4"><p>`
    if (!chstat[0]) {
      titleText = "is malfunctioning"
      statusEmoji = "&#x26A0;"
      statusText += `ClickHouse Status Info: ${chping.status} (${chping.statusText})<br/>`
    }
    if (!s3stat[0]) {
      titleText = "is offline"
      statusEmoji = "&#x274C"
      statusText += `Minio Status Info: ${s3ping.status} (${s3ping.statusText})<br/>`
    }

    statusText += `<b>Ray ID</b>: ${rayid}<br/>
      <b>Worker Version</b>: ${workerVersion}<br/>
      </p>
    `
  }

  // finish
  return staticPage(200, "OK", {}, `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
    <title>${CACHE_DOMAIN} ${titleText}</title>
    <link rel="stylesheet" href="https://stackpath.bootstrapcdn.com/bootstrap/4.3.1/css/bootstrap.min.css" integrity="sha384-ggOyR0iXCbMQv3Xipma34MD+dH/1fQ784/j6cY/iJTQUOhcWr7x9JvoRxT2MZw1T" crossorigin="anonymous">
    <style>
      body {
        padding-top:   0;
        margin-top:    4em;
        margin-bottom: 4em;
      }
      p, h1, pre, ul {
        text-align: center;
      }
      </style>
  </head>
  <body>
    <div class="container jumbotron">
      <div class="jumbotron">
        <h1 class="display-4">${CACHE_DOMAIN} ${titleText} ${statusEmoji}</h1>

        <p class="lead">
          This is a mirror of the upstream <a href="https://cache.nixos.org">Nix Binary Cache</a>,
          a service that helps speed up builds for the <a href="https://nixos.org/nix">Nix Package Manager</a>.
        </p>
        <hr class="my-4">
        <p><strong>Current mirror status</strong>:</p>
        <p>S3 Backend: ${s3stat[1]} ${s3stat[2]}</p>
        <p>ClickHouse: ${chstat[1]} ${chstat[2]}</p>
        ${statusText}
      </div>
    </div>

    <div class="container">
      <p>To use this cache, simply set the following lines in your <code>/etc/nix/nix.conf</code>:
        <pre><code>substituters = https://cache.nixos.org https://${CACHE_SUBDOMAIN}.${CACHE_DOMAIN}</code></pre>
      </p>

      <p>Or, set the following lines in your <code>configuration.nix</code>:
        <pre><code>nix.binaryCaches = [ "https://cache.nixos.org" "https://${CACHE_SUBDOMAIN}.${CACHE_DOMAIN}" ]</code></pre>
      </p>

      <p>(You may also use <code>trusted-substituters</code> instead, which will instead allow
      system users to opt-in to this cache on a per-build basis, rather than globally use it
      at all times.)</p>

      <p>There is no need to include a separate signing key. As this is only a mirror,
      upstream NAR files are used, and are already signed with the <code>cache.nixos.org</code>
      private key (so you do not need to trust the operators of this mirror).</p>

      <hr/>

      <p>
        This service is hosted and served by <a href="https://cloudflare.com">CloudFlare</a>, via
        <a href="https://cloudflareworkers.com">Workers</a>. It is automatically deployed from GitHub as
        a "live" service. The underlying storage backend for the binary objects is durable S3-compatible storage,
        provided by <a href="https://minio.io">Minio</a>. Updates to this mirror occur upon update the upstream
        <a href="https://github.com/nixos/nixpkgs-channels">nixpkgs-channels</a> repository, and are checked once
        every three hours. The services that support this mirror are completely independent of all upstream <a href="https://nixos.org">https://nixos.org</a>
        infrastructure, and running on completely separate cloud providers, to help avoid
        <abbr title="Single Points Of Failure">SPOFs</abbr>.
      </p>
      <p>
        The currently supported set of channels mirrored by this service, polled once every three hours:
        <ul class="list-unstyled">
          <li><a href="https://github.com/NixOS/nixpkgs-channels/tree/nixos-19.03-small">nixos-19.03-small</a></li>
          <li><a href="https://github.com/NixOS/nixpkgs-channels/tree/nixos-unstable-small">nixos-unstable-small</a></li>
        </ul>
      </p>
      <p>
        <b>Cache requests and responses to this service are logged</b>. Other than the first-party analytics information stored
        by CloudFlare itself, this information <b>is not shared</b> with any third-party analytics services, is stored on
        self-hosted servers (using <a href="https://clickhouse.yandex">ClickHouse</a>), and is <em>only</em> used to provide
        information to package maintainers and service operators about package usage, download distribution, and performance
        metrics of the cache. IP addresses <b>are not logged</b>. To see information about the aggregated analytics collected,
        as well as further technical details, please visit <a href="https://${LOGGING_ANALYTICS}">https://${LOGGING_ANALYTICS}</a>
      </p>

      <hr/>
      <div class="help">
        <p>The source code for this application, including this script and the data pipeline, is available
        <a href="https://github.com/thoughtpolice/nix-mirror">at this URL</a>. You may report issues and
        bugs <a href="https://github.com/thoughtpolice/nix-mirror/issues">here</a>.</p>

        <p>If you are having trouble, please reach out through one of the
        <a href="https://nixos.org/nixos/support.html">support channels</a>
        with the results of the included <a href="https://github.com/thoughtpolice/nix-mirror/tree/master/src/diagnostics">diagnostics script</a>
        which will help us figure out where the issue lies. You can run this script instantly without permanently
        installing or copying anything:

          <pre><code>nix run -f https://github.com/thoughtpolice/nix-mirror/archive/master.tar.gz -c diagnose-cache</code></pre>
        </p>

        <p><small><b>Ray ID</b>: ${rayid}<br/>
        <b>Visitor IP</b>: ${cfip} (${cfcnt})<br/>
        <b>Version</b>: ${workerVersion}<br/>
        <b>Cat fact</b>: ${fact}</small></p>
      </div>
    </div>
  </body>
</html>
`);
}

/**
 * Handle all incoming requests, and route any requests for the cache
 * subdomain to the S3 API endpoint.
 * 
 * @param {Request} r incoming original client request
 * @param {String} subdomain the particular subdomain demanded from the client
 * @return {Response} final client response
 */
async function handle(r, subdomain) {
  let s3 = new S3(S3_API_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY)
  switch (subdomain) {
    case 'www'           : return landingPage(s3, r)
    case CACHE_SUBDOMAIN : return s3.signedRequest(S3_BUCKET, r)
    default              : return invalidPage()
  }
}

/* -------------------------------------------------------------------------- */
/* -- el fin ---------------------------------------------------------------- */
