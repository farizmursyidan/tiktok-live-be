const express = require('express')
const app = express()
const port = 4000
const { pool } = require('./db_connection')
const cors = require('cors')
const session = require('express-session');
const basicAuth = require('express-basic-auth')
const http = require('http');
const { WebcastPushConnection } = require('tiktok-live-connector');
const { Server } = require('socket.io');

app.use(cors())
app.use(basicAuth({
  users: { 'admin': 'supersecret' },
  unauthorizedResponse: getUnauthorizedResponse
}))
app.use(express.json({ limit: '200mb' }))
app.use(express.urlencoded({ limit: '200mb' }))
app.use(session({
  secret: 'secret',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false }
}));

function getUnauthorizedResponse(req) {
  return req.auth ? ('Credentials ' + req.auth.user + ':' + req.auth.password + ' rejected') : 'No credentials provided'
}

app.get('/user', (req, res) => {
  pool.query(`SELECT * FROM user ORDER BY no ASC`, (error, results) => {
    if (error) {
      return res.status(400).send({
        error: 'Bad input'
      })
    }
    res.status(200).send({ user_list: results })
  })
})

app.patch('/user', (req, res) => {
  let data = req.body.data
  pool.query(`UPDATE user SET status = ${data.status}, email = '${data.email}', lisensi = '${data.lisensi}', game = '${data.game}', tgl_expired = '${data.tgl_expired}', live = ${data.live} WHERE no = ${data.no}`, (error, results) => {
    if (error) {
      return res.status(400).send({
        error: 'Bad input'
      })
    }
    res.status(200).send({ data: "User has been updated!" })
  })
})

app.post('/user', (req, res) => {
  let data = req.body.data
  pool.query(`INSERT INTO user(status, email, lisensi, game, tgl_expired) VALUES(${data.status}, '${data.email}', '${data.lisensi}', '${data.game}', '${data.tgl_expired}')`, (error, results) => {
    if (error) {
      return res.status(400).send({
        error: 'Bad input'
      })
    }
    res.status(200).send({ data: "User has been added!" })
  })
})

app.get('/aktivitas', (req, res) => {
  pool.query(`SELECT * FROM aktivitas ORDER BY no DESC`, (error, results) => {
    if (error) {
      return res.status(400).send({
        error: 'Bad input'
      })
    }
    res.status(200).send({ aktivitas: results })
  })
})

let server = http.createServer(app)
server.listen(8081)

const io = new Server(server, {
  cors: {
    origin: '*'
  }
});

app.get('/connectLive', (req, res) => {
  let username = req.body.username
  let lisensi = req.body.lisensi
  let game = req.body.game
  let email = req.body.email

  pool.query(`SELECT * FROM user WHERE status = true AND email = '${email}' AND lisensi = '${lisensi}' AND game LIKE '%${game}%' AND tgl_expired > '${convertDateFormatFull(new Date())}'`, (error, resultsCekLisensi) => {
    if (error) {
      return res.status(400).send({
        error: 'Bad input'
      })
    }

    if (resultsCekLisensi.length === 0) {
      return res.status(400).send({
        error: 'Gagal connect live!'
      })
    } else {
      if (resultsCekLisensi[0].live) {
        pool.query(`SELECT * FROM aktivitas WHERE email = '${email}' AND game = '${game}' ORDER BY no DESC`, (error, resultsCekLive) => {
          if (resultsCekLive.length === 0) {
            return res.status(400).send({
              error: 'Gagal connect live!'
            })
          } else if (resultsCekLive[0].username_tiktok !== username) {
            return res.status(400).send({
              error: 'Gagal connect live!'
            })
          } else {
            // Username of someone who is currently live
            let tiktokUsername = username;

            // Create a new wrapper object and pass the username
            let tiktokLiveConnection = new WebcastPushConnection(tiktokUsername);

            // Connect to the chat (await can be used as well)
            tiktokLiveConnection.connect().then(state => {
              console.info(`Connected to roomId ${state.roomId}`);
              pool.query(`INSERT INTO aktivitas(email, username_tiktok, game, total_gift, tgl_live) VALUES('${email}', '${username}', '${game}', '0', '${convertDateFormatFull(new Date())}')`)
              pool.query(`UPDATE user SET live = true WHERE email = '${email}'`)
              res.status(200).send({ message: `Connected to roomId ${state.roomId}` })
            }).catch(err => {
              console.error('Failed to connect', err);
              return res.status(400).send({ error: 'Failed to connect, ' + err })
            })

            io.on('connection', (socket) => {
              tiktokLiveConnection.on('chat', msg => socket.emit('chat', { room: `room_${username}`, message: msg }));
              tiktokLiveConnection.on('roomUser', msg => socket.emit('roomUser', { room: `room_${username}`, message: msg }));
              tiktokLiveConnection.on('member', msg => socket.emit('member', { room: `room_${username}`, message: msg }));
              tiktokLiveConnection.on('chat', msg => socket.emit('chat', { room: `room_${username}`, message: msg }));
              tiktokLiveConnection.on('gift', msg => {
                socket.emit('gift', { room: `room_${username}`, message: msg });
                pool.query(`SELECT * FROM aktivitas WHERE email = '${email}' AND username_tiktok = '${username}' AND game = '${game}' ORDER BY no DESC`, (error, resultsCekAktivitas) => {
                  let gift = resultsCekAktivitas[0].total_gift
                  let new_gift = Number(gift + msg.diamondCount)
                  pool.query(`UPDATE aktivitas SET total_gift = ${new_gift} WHERE no = ${resultsCekAktivitas[0].no}`)
                })
              });
              tiktokLiveConnection.on('social', msg => socket.emit('social', { room: `room_${username}`, message: msg }));
              tiktokLiveConnection.on('like', msg => socket.emit('like', { room: `room_${username}`, message: msg }));
              tiktokLiveConnection.on('questionNew', msg => socket.emit('questionNew', { room: `room_${username}`, message: msg }));
              tiktokLiveConnection.on('linkMicBattle', msg => socket.emit('linkMicBattle', { room: `room_${username}`, message: msg }));
              tiktokLiveConnection.on('linkMicArmies', msg => socket.emit('linkMicArmies', { room: `room_${username}`, message: msg }));
              tiktokLiveConnection.on('liveIntro', msg => socket.emit('liveIntro', { room: `room_${username}`, message: msg }));
              tiktokLiveConnection.on('emote', msg => socket.emit('emote', { room: `room_${username}`, message: msg }));
              tiktokLiveConnection.on('envelope', msg => socket.emit('envelope', { room: `room_${username}`, message: msg }));
              tiktokLiveConnection.on('subscribe', msg => socket.emit('subscribe', { room: `room_${username}`, message: msg }));
              tiktokLiveConnection.on('disconnected', reason => socket.emit('disconnected', `TikTok connection disconnected ${reason}`));
              tiktokLiveConnection.on('streamEnd', () => {
                socket.emit('streamEnd', 'live selesai');
              });

              socket.on('dc', () => {
                if (tiktokLiveConnection) {
                  tiktokLiveConnection.disconnect();
                }
                pool.query(`UPDATE user SET live = false WHERE email = '${email}'`)
              });
            });
          }
        })
      }
    }
  })
})

///////////
// let server = http.createServer(app)
// server.listen(8081)

// const io = new Server(server, {
//   cors: {
//     origin: '*'
//   }
// });

// io.on('connection', (socket) => {
//   // socket.join("room1");
//   // io.to("room1").emit("event", { room: 'room1', message: 'hello room1!' });
//   // socket.join("room2");
//   // io.to("room2").emit("event", { room: 'room2', message: 'hello room2!' });
//   socket.emit('event', { room: 'room1', message: 'test1' })
//   socket.emit('event', { room: 'room2', message: 'test2' })
// })
///////////

app.post('/loginUser', (req, res) => {
  let username = req.body.username
  let password = req.body.password

  pool.query(`SELECT * FROM user_login WHERE username = '${username}' AND password = '${password}'`, (error, results) => {
    if (error) {
      return res.status(400).send({
        error: 'Bad input'
      })
    }

    if (results.length > 0) {
      req.session.loggedin = true;
      req.session.username = username;
      res.status(200).send({
        "code": 200,
        "status": "OK",
        "data": {
          "login_status": "logged_in",
          "username": username
        }
      })
    } else {
      return res.status(401).send({
        "code": 401,
        "status": "Wrong Username and Password!",
        "data": {
          "login_status": "login_failed"
        }
      })
    }
  })
})

app.post('/logoutUser', (req, res) => {
  req.session.destroy((err) => { })
  res.send({ "login_status": "logged_out" })
})

const convertDateFormatFull = (jsondate) => {
  if (jsondate !== undefined && jsondate !== null) {
    let date = new Date(jsondate);
    let year = date.getFullYear();
    let month = date.getMonth() + 1;
    let dt = date.getDate();
    let hh = date.getHours();
    let mm = date.getMinutes();
    let ss = date.getSeconds();

    if (dt < 10) {
      dt = "0" + dt;
    }
    if (month < 10) {
      month = "0" + month;
    }
    return year + "-" + month + "-" + dt.toString().padStart(2, 0) + " " + hh.toString().padStart(2, 0) + ":" + mm.toString().padStart(2, 0) + ":" + ss.toString().padStart(2, 0);
  } else {
    return null
  }
};

app.listen(port, () => {
  console.log(`Server is listening on port ${port}`)
})