const path = require("path");
const process = require("process");
const { Worker } = require("worker_threads");
const caller = require("grpc-caller");
const PROTO_PATH = path.resolve(__dirname, "../protos/chord.proto");

const HASH_BIT_LENGTH = 8;
const NULL_NODE = { id: null, host: null, port: null };
const DEBUGGING_LOCAL = false;

/**
 * Accounts for the modulo arithmetic to determine whether the input value is within the bounds.
 * Implements inclusive and exclusive properties for each bound, as specified.
 *
 *      USAGE
 *      includeLower == true means [lowerBound, ...
 *      includeLower == false means (lowerBound, ...
 *      includeUpper == true means ..., upperBound]
 *      includeUpper == false means ..., upperBound)
 *
 * @param {number} inputValue
 * @param {number} lowerBound
 * @param {boolean} includeLower
 * @param {number} upperBound
 * @param {boolean} includeUpper
 * @returns {boolean} true if the input value is in - modulo - bounds; false otherwise
 */
function isInModuloRange(
  inputValue,
  lowerBound,
  includeLower = true,
  upperBound,
  includeUpper = false
) {
  if (includeLower && includeUpper) {
    if (lowerBound > upperBound) {
      //looping through 0
      return inputValue >= lowerBound || inputValue <= upperBound;
    } else {
      return inputValue >= lowerBound && inputValue <= upperBound;
    }
  } else if (includeLower && !includeUpper) {
    if (lowerBound > upperBound) {
      //looping through 0
      return inputValue >= lowerBound || inputValue < upperBound;
    } else {
      return inputValue >= lowerBound && inputValue < upperBound;
    }
  } else if (!includeLower && includeUpper) {
    if (lowerBound > upperBound) {
      //looping through 0
      return inputValue > lowerBound || inputValue <= upperBound;
    } else {
      return inputValue > lowerBound && inputValue <= upperBound;
    }
  } else {
    if (lowerBound > upperBound) {
      //looping through 0
      return inputValue > lowerBound || inputValue < upperBound;
    } else {
      return inputValue > lowerBound && inputValue < upperBound;
    }
  }
}

/**
 * Creates a worker thread to execute crypto and returns a result.
 * To use `const result = await sha1("stuff2");`
 * @param {string} source
 * @returns {Promise} - Resolves to the SHA-1 hash of source
 */
function sha1(source) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, "./cryptoThread.js"), {
      workerData: source
    });
    worker.on("message", resolve);
    worker.on("error", reject);
  });
}

const MAX_BIT_LENGTH = 32;
/** Compute a hash of desired length for the input string.
 * The function uses SHA-1 to compute an intermmediate string output,
 * then truncates to the user-specified size from the high-order bits.
 *
 * @param {string} stringForHashing
 */
async function computeIntegerHash(stringForHashing) {
  // enable debugging output
  const DEBUGGING_LOCAL = false;

  const MAX_JS_INT_BIT_LENGTH = 32;
  const BIT_PER_HEX_CHARACTER = 4;
  if (HASH_BIT_LENGTH > MAX_BIT_LENGTH) {
    console.error(
      `Warning. Requested ${HASH_BIT_LENGTH} bits `,
      `but only ${MAX_BIT_LENGTH} bits available due to numerical simplification.`
    );
    process.exit(-9);
  }
  let hashOutput = await sha1(stringForHashing);
  if (DEBUGGING_LOCAL)
    console.log(`Full hash of "${stringForHashing}" is ${hashOutput}.`);

  /* JavaScript only does bitwise operations on 32-bit numbers
     so keep only the top 32 bits of the hashed value.
  */
  hashOutput = hashOutput.slice(
    0,
    MAX_JS_INT_BIT_LENGTH / BIT_PER_HEX_CHARACTER
  );
  if (DEBUGGING_LOCAL) console.log(`Truncated string value is ${hashOutput}.`);

  // convert from hexadecimal to decimal
  integerHash = parseInt("0x" + hashOutput);
  if (DEBUGGING_LOCAL) console.log(`Integer value is ${integerHash}.`);

  // truncate the hash to the desired number of bits by picking the high-order bits
  integerHash = integerHash >>> (MAX_BIT_LENGTH - HASH_BIT_LENGTH);
  if (DEBUGGING_LOCAL)
    console.log(`Truncated integer value is ${integerHash}.`);

  return integerHash;
}

async function computeHostPortHash(host, port) {
  return computeIntegerHash(`${host}:${port}`);
}

function handleGRPCErrors(scope, call, host, port, err) {
  switch (err.code) {
    case 0:
      console.log(
        `${scope}: call to ${call} on ${host}:${port} returned OK. Should not have thrown`
      );
      break;
    case 1:
      console.log(`${scope}: call to ${call} on ${host}:${port} was cancelled`);
      break;
    case 2:
      console.error(
        `${scope}: call to ${call} on ${host}:${port} returned unknown error`
      );
      break;
    case 3:
      console.error(
        `${scope}: call to ${call} on ${host}:${port} rejected due to invalid arguments`
      );
      break;
    case 4:
      console.error(
        `${scope}: call to ${call} on ${host}:${port} exceeded deadline`
      );
      break;
    case 5:
      console.error(
        `${scope}: call to ${call} on ${host}:${port} requested an entity that was not found`
      );
      break;
    case 6:
      console.error(
        `${scope}: call to ${call} on ${host}:${port} attempted to created an entity that already exists`
      );
      break;
    case 7:
      console.error(
        `${scope}: call to ${call} on ${host}:${port} rejected because permission was denied`
      );
      break;
    case 8:
      console.error(
        `${scope}: call to ${call} on ${host}:${port} failed because a resource is exhausted`,
        err
      );
      break;
    case 9:
      console.error(
        `${scope}: call to ${call} on ${host}:${port} failed due to pailed precondition `,
        err
      );
      break;
    case 10:
      console.error(
        `${scope}: call to ${call} on ${host}:${port} was aborted `,
        err
      );
      break;
    case 11:
      console.error(
        `${scope}: call to ${call} on ${host}:${port} rejected because out of range`,
        err
      );
      break;
    case 12:
      console.error(
        `${scope}: call to ${call} on ${host}:${port}, which is unimplemented `,
        err
      );
      break;
    case 13:
      console.error(
        `${scope}: call to ${call} on ${host}:${port} caused Internal Error `
      );
      console.trace(err);
      break;
    case 14:
      console.log(`${scope}: Unable to connect to ${host}:${port}`);
      break;
    case 15:
      console.log(
        `${scope}: call to ${call} on ${host}:${port} failed due to unrecoverable data loss or corruption`
      );
      break;
    case 16:
      console.error(
        `${scope}: call to ${call} on ${host}:${port} rejected because authentication credentials were missing`
      );
      break;
    default:
      console.trace(`${scope}:`, err);
  }
}

function connect({ host, port }) {
  return caller(`${host}:${port}`, PROTO_PATH, "Node");
}

module.exports = {
  connect,
  handleGRPCErrors,
  isInModuloRange,
  computeHostPortHash,
  computeIntegerHash,
  sha1,
  DEBUGGING_LOCAL,
  HASH_BIT_LENGTH,
  NULL_NODE
};