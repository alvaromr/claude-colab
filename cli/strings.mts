// What the CLI tells people, in each language colab speaks; TEXT is the one this process's locale asks for.
import { DEFAULT_PORT, type Language, languageOf, NAME_RULE, type Refusal } from './protocol.mts'

/** The values the help shows as defaults, which only the entry point knows. */
export type Defaults = { machine: string; user: string; log: string; socket: string }
type Help = { summary: string; usage: string; help: (d: Defaults) => string }
type Reply = Record<string, unknown>

const KEY_ES = 'La clave nunca va en la línea de comandos: ahí la vería cualquiera con ps.'
const SOCKET_ES = (d: Defaults) =>
  `  --socket <ruta>  socket local de connect (por defecto, CLAUDE_COLAB_SOCKET o ${d.socket})`

const es = {
  refused: {
    'bad-name': () => `Nombre no válido: ${NAME_RULE.es}`,
    'claude-name': () => 'Nombre no válido: «Claude de» es como se ve lo que escribe el Claude de cada uno',
    'name-taken': r => `Ya hay alguien conectado como ${r.name}`,
    'bad-room-name': () => `Nombre de sala no válido: ${NAME_RULE.es}`,
    'bad-code': () => 'Código de sala no válido',
    'rooms-full': r => `El servidor ya tiene ${r.max} salas, todas con alguien dentro`,
    'room-gone': () => 'Invitación no válida: la sala ya no existe',
    elsewhere: r => `Ya estás en la sala ${r.label}: sal antes`,
    'not-in-room': () => 'No estás en ninguna sala',
    'no-text': () => 'Falta el texto',
    'text-too-long': r => `El texto pasa de ${r.max} caracteres`,
    'not-member': r => `${r.to} no está en la sala ${r.label}`,
    malformed: () => 'Petición mal formada: op, name, to y code son texto',
    'unknown-op': r => `Operación desconocida: ${r.op}`,
  } satisfies Record<Refusal, (reply: Reply) => string>,
  noInbox: 'Esta sesión no tiene buzón (CLAUDE_CODE_MESSAGING_SOCKET)',
  inboxSilent: 'El buzón no ha respondido',
  serverSilent: 'El servidor no ha respondido',
  serverGone: 'El servidor ha dejado de responder',
  otherVersion: (at: string) => `${at} es un servidor de otra versión de claude-colab: ciérralo y ábrelo`,
  noAddress: 'Este equipo no tiene ninguna dirección de red',
  connectThere: (path: string) => `Ya hay un connect escuchando en ${path}`,
  noConnect: (path: string) => `No hay ningún connect escuchando en ${path}`,
  socketTooLong: (path: string) => `La ruta del socket es demasiado larga para este sistema: ${path}`,
  unknownRequest: (what: string) => `Petición desconocida: ${what}`,
  notJson: 'El cuerpo no es JSON',
  notObject: 'El cuerpo no es un objeto JSON',
  notPrivateFolder: (folder: string) =>
    `${folder} tiene que ser solo tuyo (chmod 700): guarda sockets y claves de claude-colab`,
  notPrivateParent: (folder: string) =>
    `${folder}, por encima de la carpeta de claude-colab, lo pueden cambiar otros: que solo tú o root podáis escribir en él (chmod go-w), o ponle el bit sticky (chmod +t)`,
  notPrivateKey: (file: string) =>
    `${file} tiene que ser un fichero solo tuyo (chmod 600): guarda una clave de claude-colab`,
  noKey: (at: string) => `No hay clave para ${at}: guárdala con claude-colab key ${at}`,
  badInvitation: 'La invitación no es válida: cópiala entera, empieza por colab:',
  badKey: 'La clave no es válida: son 32 bytes en base64url, como la que da serve',
  certificate: 'El servidor no usa la clave: presenta un certificado',
  serverHere: (at: string) => `Ya hay un servidor en este equipo: escucha en ${at}`,
  portInUse: (port: number) => `El puerto ${port} lo usa otro programa`,
  noServer: 'No hay ningún servidor abierto en este equipo',
  notStopped: 'El servidor no se ha cerrado',
  neverListened: (port: number, code: number | null, log: string) =>
    `El servidor del puerto ${port} terminó sin escuchar (${code}): mira ${log}`,
  badPort: (text: string) => `Puerto no válido: ${text}`,
  unknownCommand: (name: string) => `Comando desconocido: ${name}`,
  usage: (usage: string) => `Uso: ${usage}`,
  main: (commands: string) => `claude-colab: conecta sesiones de Claude Code de personas distintas por red local o VPN.

Comandos:
${commands}

Ayuda de cada uno: claude-colab <comando> --help
Responde en JSON; sale con 1 si "ok" es false y con 2 si los argumentos no son válidos.`,
  commands: {
    serve: {
      summary: 'abre el servidor de salas de este equipo',
      usage: 'claude-colab serve [--name <nombre>] [--host <ip>] [--port <puerto>] [--new-key] [--background]',
      help: d => `Escucha conexiones cifradas con TLS 1.3 y una clave compartida. Quien no tenga la clave no pasa del saludo TLS.
Hay uno por equipo: si ya hay uno escuchando, no abre otro.
${KEY_ES} Toma la que ya guardó para 127.0.0.1:<puerto>, así que al reabrir el servidor los demás no
necesitan otra; si no hay ninguna, genera una. La devuelve en "key":
pásala a los demás por otro medio. La guarda como la de 127.0.0.1:<puerto>, para conectarte desde este equipo.
Escribe una línea JSON al empezar a escuchar y sigue hasta Ctrl+C.

  --name <nombre>   cómo lo ven los que se conectan (por defecto, el de este equipo: ${d.machine})
  --host <ip>       interfaz donde escucha (por defecto 0.0.0.0, todas)
  --port <puerto>   puerto TCP (por defecto ${DEFAULT_PORT})
  --new-key         genera una clave nueva aunque haya una guardada: la anterior deja de valer
  --background      lo deja en segundo plano, aunque se cierre la terminal o la sesión que lo abrió; responde
                    cuando escucha. Su salida va a ${d.log}; se cierra con claude-colab stop`,
    },
    status: {
      summary: 'dice si hay un servidor de salas abierto en este equipo',
      usage: 'claude-colab status',
      help: () => `Responde "running": false, o true con "listening", "title", "pid", "key": la clave que se pasa a los demás, y
"addresses": las IP de red del equipo, por donde lo alcanzan los demás.
Siempre da "machine": el nombre que toma el servidor si se abre sin --name.`,
    },
    stop: {
      summary: 'cierra el servidor de salas de este equipo',
      usage: 'claude-colab stop',
      help: () => 'Todos los que estaban conectados a él quedan desconectados.',
    },
    key: {
      summary: 'guarda la clave de un servidor, leída de la entrada estándar',
      usage: 'claude-colab key <ip>[:<puerto>] < fichero-con-la-clave',
      help: () => `Lee la clave de la entrada estándar (en la terminal: pégala y pulsa Ctrl+D) y la guarda solo para ti, en
~/.claude-colab/keys. connect la usa para ese servidor. ${KEY_ES}`,
    },
    connect: {
      summary: 'se conecta a un servidor de salas y escucha lo que llega',
      usage: 'claude-colab connect <ip>[:<puerto>] [--name <nombre>] [--socket <ruta>]',
      help: d => `Abre la conexión con el servidor y la mantiene. Usa la clave guardada con key.
Escribe una línea JSON por evento: "connected", "rooms" (la lista de salas cambió), "member" (alguien entró o
salió de una de tus salas), "message" (con "own": true si es tuyo), "error" (con "reason": "name-taken" si tu
nombre ya está en uso allí) y "disconnected" al terminar.
Los demás comandos hablan con este proceso por su socket local.

  --name <nombre>   tu nombre en el servidor, único allí (por defecto, tu usuario: ${d.user})
${SOCKET_ES(d)}`,
    },
    rooms: {
      summary: 'lista tu sala y quién está en ella: las demás no se ven',
      usage: 'claude-colab rooms [--socket <ruta>]',
      help: SOCKET_ES,
    },
    create: {
      summary: 'crea una sala y entra en ella',
      usage: 'claude-colab create [--name <sala>] [--socket <ruta>]',
      help: d => `La sala dura lo que el servidor, aunque se quede vacía. Su "code" es lo que la identifica: solo entra
quien lo tiene, con la invitación que da invite. Su "label", el siguiente número, es solo para mostrarla.

  --name <sala>    lo que se muestra en lugar del número
${SOCKET_ES(d)}`,
    },
    invite: {
      summary: 'da la invitación a tu sala, para pasarla por otro medio',
      usage: 'claude-colab invite [--socket <ruta>]',
      help: d => `Devuelve en "invitation" un texto con lo que hace falta para entrar en tu sala desde otro equipo: las
direcciones de este servidor, su puerto, su clave, la sala y su código. Pásala por otro medio, como la clave: quien
la tiene entra.

${SOCKET_ES(d)}`,
    },
    accept: {
      summary: 'guarda la clave de una invitación, leída de la entrada estándar',
      usage: 'claude-colab accept < fichero-con-la-invitación',
      help: () => `Guarda solo para ti la clave del servidor de la invitación, para cada una de sus direcciones, y devuelve
en "servers" esas direcciones: conéctate a una con connect y entra en la sala con join. ${KEY_ES}`,
    },
    join: {
      summary: 'entra en una sala con su invitación, leída de la entrada estándar',
      usage: 'claude-colab join [--socket <ruta>] < fichero-con-la-invitación',
      help: d => `Hace falta estar conectado al servidor de la invitación.\n\n${SOCKET_ES(d)}`,
    },
    leave: {
      summary: 'sale de tu sala',
      usage: 'claude-colab leave [--socket <ruta>]',
      help: d => `La sala sigue abierta: vuelves con su invitación.\n\n${SOCKET_ES(d)}`,
    },
    say: {
      summary: 'manda un mensaje a tu sala',
      usage: 'claude-colab say <texto> [--to <nombre>] [--claude] [--socket <ruta>]',
      help: d => `Todos los de tu sala lo reciben. Devuelve el "id" del mensaje.

  --to <nombre>    lo dirige a alguien de la sala; los demás también lo ven
  --claude         lo firma tu Claude, no tú
${SOCKET_ES(d)}`,
    },
  } satisfies Record<string, Help>,
}

const KEY_EN = 'The key never goes on the command line, where anyone could see it with ps.'
const SOCKET_EN = (d: Defaults) =>
  `  --socket <path>  connect's local socket (by default, CLAUDE_COLAB_SOCKET or ${d.socket})`

const en: typeof es = {
  refused: {
    'bad-name': () => `Invalid name: ${NAME_RULE.en}`,
    'claude-name': () => 'Invalid name: «Claude de» is how Spanish clients show what each one’s Claude writes',
    'name-taken': r => `Someone is already connected as ${r.name}`,
    'bad-room-name': () => `Invalid room name: ${NAME_RULE.en}`,
    'bad-code': () => 'Invalid room code',
    'rooms-full': r => `The server already has ${r.max} rooms, all with someone in`,
    'room-gone': () => 'Invalid invitation: the room no longer exists',
    elsewhere: r => `You are already in room ${r.label}: leave it first`,
    'not-in-room': () => 'You are in no room',
    'no-text': () => 'The text is missing',
    'text-too-long': r => `The text is over ${r.max} characters`,
    'not-member': r => `${r.to} is not in room ${r.label}`,
    malformed: () => 'Malformed request: op, name, to and code are text',
    'unknown-op': r => `Unknown operation: ${r.op}`,
  },
  noInbox: 'This session has no inbox (CLAUDE_CODE_MESSAGING_SOCKET)',
  inboxSilent: 'The inbox did not answer',
  serverSilent: 'The server did not answer',
  serverGone: 'The server stopped answering',
  otherVersion: at => `${at} is a server of another version of claude-colab: close it and open it again`,
  noAddress: 'This machine has no network address',
  connectThere: path => `A connect is already listening on ${path}`,
  noConnect: path => `No connect is listening on ${path}`,
  socketTooLong: path => `The socket's path is too long for this system: ${path}`,
  unknownRequest: what => `Unknown request: ${what}`,
  notJson: 'The body is not JSON',
  notObject: 'The body is not a JSON object',
  notPrivateFolder: folder => `${folder} must be yours alone (chmod 700): it holds claude-colab's sockets and keys`,
  notPrivateParent: folder =>
    `${folder}, above claude-colab's folder, can be changed by others: let only you or root write in it (chmod go-w), or make it sticky (chmod +t)`,
  notPrivateKey: file => `${file} must be a file of yours alone (chmod 600): it holds a claude-colab key`,
  noKey: at => `No key for ${at}: save it with claude-colab key ${at}`,
  badInvitation: 'The invitation is not valid: copy all of it, it starts with colab:',
  badKey: 'The key is not valid: it is 32 bytes in base64url, like the one serve gives',
  certificate: 'The server does not use the key: it shows a certificate',
  serverHere: at => `This machine already has a server: it listens on ${at}`,
  portInUse: port => `Port ${port} is in use by another program`,
  noServer: 'This machine has no server open',
  notStopped: 'The server has not closed',
  neverListened: (port, code, log) => `The server on port ${port} ended without listening (${code}): see ${log}`,
  badPort: text => `Invalid port: ${text}`,
  unknownCommand: name => `Unknown command: ${name}`,
  usage: usage => `Usage: ${usage}`,
  main: commands => `claude-colab: connects the Claude Code sessions of different people over a LAN or a VPN.

Commands:
${commands}

Help on each: claude-colab <command> --help
Answers in JSON; exits with 1 if "ok" is false and with 2 if the arguments are not valid.`,
  commands: {
    serve: {
      summary: 'opens this machine’s room server',
      usage: 'claude-colab serve [--name <name>] [--host <ip>] [--port <port>] [--new-key] [--background]',
      help: d => `Listens for connections encrypted with TLS 1.3 and a shared key. Without the key, no one gets past the TLS handshake.
There is one per machine: if one is listening already, it opens no other.
${KEY_EN} It takes the one it saved for 127.0.0.1:<port>, so that on reopening the server the others need
no new one; if there is none, it makes one. It returns it in "key":
pass it to the others by another means. It saves it as the key of 127.0.0.1:<port>, to connect from this machine.
Writes a JSON line once it listens, and runs until Ctrl+C.

  --name <name>     how those who connect see it (by default, this machine's: ${d.machine})
  --host <ip>       interface it listens on (by default 0.0.0.0, all)
  --port <port>     TCP port (by default ${DEFAULT_PORT})
  --new-key         makes a new key even if one is saved: the old one stops working
  --background      leaves it running in the background, even when the terminal or session that opened it closes;
                    answers once it listens. Its output goes to ${d.log}; claude-colab stop closes it`,
    },
    status: {
      summary: 'says whether this machine has a room server open',
      usage: 'claude-colab status',
      help: () => `Answers "running": false, or true with "listening", "title", "pid", "key": the key passed to the others, and
"addresses": the machine's network IPs, where the others reach it.
Always gives "machine": the name the server takes when opened without --name.`,
    },
    stop: {
      summary: 'closes this machine’s room server',
      usage: 'claude-colab stop',
      help: () => 'Everyone connected to it is disconnected.',
    },
    key: {
      summary: 'saves a server’s key, read from standard input',
      usage: 'claude-colab key <ip>[:<port>] < file-with-the-key',
      help: () => `Reads the key from standard input (in a terminal: paste it and press Ctrl+D) and saves it for you alone, in
~/.claude-colab/keys. connect uses it for that server. ${KEY_EN}`,
    },
    connect: {
      summary: 'connects to a room server and listens to what arrives',
      usage: 'claude-colab connect <ip>[:<port>] [--name <name>] [--socket <path>]',
      help: d => `Opens the connection to the server and keeps it. Uses the key saved with key.
Writes one JSON line per event: "connected", "rooms" (the list of rooms changed), "member" (someone came into or
left one of your rooms), "message" (with "own": true if it is yours), "error" (with "reason": "name-taken" if your
name is in use there) and "disconnected" at the end.
The other commands talk to this process over its local socket.

  --name <name>     your name on the server, unique there (by default, your user: ${d.user})
${SOCKET_EN(d)}`,
    },
    rooms: {
      summary: 'lists your room and who is in it: the others are not shown',
      usage: 'claude-colab rooms [--socket <path>]',
      help: SOCKET_EN,
    },
    create: {
      summary: 'makes a room and goes into it',
      usage: 'claude-colab create [--name <room>] [--socket <path>]',
      help: d => `The room lasts as long as the server, empty too. Its "code" is what identifies it: only who has it gets in,
with the invitation invite gives. Its "label", the next number, is only for showing it.

  --name <room>    what is shown instead of the number
${SOCKET_EN(d)}`,
    },
    invite: {
      summary: 'gives the invitation to your room, to pass on by another means',
      usage: 'claude-colab invite [--socket <path>]',
      help: d => `Returns in "invitation" a text with what it takes to go into your room from another machine: this server's
addresses, its port, its key, the room and its code. Pass it on by another means, like the key: whoever has it gets
in.

${SOCKET_EN(d)}`,
    },
    accept: {
      summary: 'saves the key of an invitation, read from standard input',
      usage: 'claude-colab accept < file-with-the-invitation',
      help: () => `Saves for you alone the key of the invitation's server, for each of its addresses, and returns those
addresses in "servers": connect to one with connect and go into the room with join. ${KEY_EN}`,
    },
    join: {
      summary: 'goes into a room with its invitation, read from standard input',
      usage: 'claude-colab join [--socket <path>] < file-with-the-invitation',
      help: d => `It takes being connected to the invitation's server.\n\n${SOCKET_EN(d)}`,
    },
    leave: {
      summary: 'leaves your room',
      usage: 'claude-colab leave [--socket <path>]',
      help: d => `The room stays open: you come back with its invitation.\n\n${SOCKET_EN(d)}`,
    },
    say: {
      summary: 'sends a message to your room',
      usage: 'claude-colab say <text> [--to <name>] [--claude] [--socket <path>]',
      help: d => `Everyone in your room gets it. Returns the message's "id".

  --to <name>      addresses it to someone in the room; the others see it too
  --claude         signed by your Claude, not by you
${SOCKET_EN(d)}`,
    },
  },
}

export const TEXTS: Record<Language, typeof es> = { es, en }
export const TEXT = TEXTS[languageOf(process.env)]
