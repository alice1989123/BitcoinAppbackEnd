"use-strict";
const WebSocket = require("ws");
const axios = require("axios");
const express = require("express");
const app = express();
const MongoClient = require("mongodb").MongoClient;
const dotenv = require("dotenv");
const Binance = require("node-binance-api");
const cors = require("cors");
const bodyParser = require("body-parser");
const session = require("express-session");
const { ObjectId } = require("mongodb");

//Load enviroment variables
dotenv.config();

const user = process.env.DB_USER;
const pw = process.env.DB_KEY;
var corsOptions = {
  credentials: true,
  /*   allowedHeaders: [
    "Content-Type",
    "Authorization",
    "Access-Control-Allow-Credentials",
  ], */
  origin: "http://localhost:4200",
  optionsSuccessStatus: 200, // For legacy browser support
};

//Add middleWares

app.use(cors(corsOptions));
app.use(
  session({
    secret: process.env.SECRET,
    name: "bitcoin", // Customise the name
    resave: false,
    saveUninitialized: true,
    // cookie: { secure: true }, deactivated for testing in localHost
  })
);
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
/* app.use((request, response, next) => {
  response.status(200).end();
}); */

//function to fetch price

const getBTCprice = async () => {
  const response = await axios.get("https://api.coincap.io/v2/assets/bitcoin");
  return response.data.data.priceUsd;
};

const uri = `mongodb+srv://${user}:${pw}@cluster0.eshcn.mongodb.net/myFirstDatabase?retryWrites=true&w=majority`;

app.get("/", (req, res) => {
  res.status(200).send("1");
});

app.post("/log_in", (req, res) => {
  const client = new MongoClient(uri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  const { User, Password } = req.body;

  client.connect(function (err, db) {
    if (err) throw err;
    const log_in = async () => {
      const dbo = db.db("Bitcoin-fetch");
      const users = dbo.collection("accounts");
      const userDatabase = await users.findOne({ User: User });
      if (!userDatabase) {
        res.status(403).send("Forbidden");
      }

      if (userDatabase.Password === Password) {
        req.session.isAuth = true;
        req.session.username = userDatabase._id.toHexString(); // the Id is used to handle the user
        req.session.timestamps = +new Date(); // The timestamps allows us to only allow cookies for a period of time
        res.set("Access-Control-Allow-Credentials", true);
        //req.redirect("/trade");
        res.status(200).send("Succesuflly logged");
        await client.close();
      } else {
        res.status(403).send("Forbidden");
      }
    };
    try {
      log_in();
    } catch {
      (e) => console.log(e);
    }
  });
});

app.get("/funds", (req, res) => {
  const client = new MongoClient(uri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  if (req.session.isAuth) {
    if (+new Date() - req.session.timestamps <= 2400000) {
      client.connect(function (err, db) {
        if (err) throw err;
        const getFunds = async () => {
          const dbo = db.db("Bitcoin-fetch");
          const users = dbo.collection("accounts");
          const userDatabase = await users.findOne({
            _id: ObjectId.createFromHexString(req.session.username),
          });
          const { balance } = userDatabase;
          await client.close();
          return balance;
        };
        getFunds()
          .then((r) => res.status(200).send(r))
          .catch((e) => {
            console.log(e);
            res.status(500).send("Internal Server Error");
          });
      });
    } else {
      res.set("Access-Control-Allow-Credentials", true);
      res.status(408).send("TimedOut");
    }
  } else {
    res.status(403).send("Forbiden");
  }
});

app.get("/trades", (req, res) => {
  const client = new MongoClient(uri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  if (req.session.isAuth) {
    if (+new Date() - req.session.timestamps <= 2400000) {
      client.connect(function (err, db) {
        if (err) throw err;
        const getFunds = async () => {
          const dbo = db.db("Bitcoin-fetch");
          const users = dbo.collection("accounts");
          const userDatabase = await users.findOne({
            _id: ObjectId.createFromHexString(req.session.username),
          });
          const { trades } = userDatabase;

          return JSON.stringify(trades);
        };
        getFunds()
          .then((r) => res.status(200).send(r))
          .catch((e) => {
            console.log(e);
            res.status(500).send("Internal Server Error");
          });
      });
    } else {
      res.set("Access-Control-Allow-Credentials", true);
      res.status(408).send("TimedOut");
    }
  } else {
    res.status(403).send("Forbiden");
  }
});

app.post("/operation", (req, res) => {
  const client = new MongoClient(uri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  const { side, qty } = req.body;
  if (
    (side === "buy" || side === "sell") &&
    typeof Number(qty) === "number" &&
    Number(qty) >= 0
  ) {
    console.log(req.session);
    if (req.session.isAuth) {
      if (+new Date() - req.session.timestamps <= 2400000) {
        // If there have passed less than 40 minutes from the log-in
        client.connect(function (err, db) {
          if (err) throw err;
          const operate = async () => {
            const dbo = db.db("Bitcoin-fetch");
            const users = dbo.collection("accounts");
            const userDatabase = await users.findOne({
              _id: ObjectId.createFromHexString(req.session.username),
            });
            const { balance } = userDatabase;
            const priceStr = await getBTCprice(); // fetch price from CoinMarketCap

            const price = Number(priceStr);

            const trade = {
              quantity: qty,
              price: price,
              side: side,
              date: new Date(),
            };

            if (side === "buy") {
              const USDneeded = price * Number(qty);
              const USDavailable = balance.USD;
              console.log(USDneeded, USDavailable);

              if (USDavailable <= USDneeded) {
                res.status(400).send("Not enought Funds");
              } else {
                const newUSD = USDavailable - USDneeded;
                const newBTC = balance.BTC + Number(qty);
                await users.updateOne(
                  { _id: ObjectId.createFromHexString(req.session.username) },
                  { $set: { balance: { USD: newUSD, BTC: newBTC } } }
                );
                await users.updateOne(
                  { _id: ObjectId.createFromHexString(req.session.username) },
                  { $push: { trades: trade } }
                );

                await client.close();
                res.status(200).send("Operation succeded");
              }
            }

            if (side === "sell") {
              const BTCavailable = balance.BTC;
              if (BTCavailable <= Number(qty)) {
                res.status(400).send("Not enought Funds");
              } else {
                const newUSD = balance.USD + Number(qty) * price;
                const newBTC = balance.BTC - Number(qty);
                await users.updateOne(
                  { _id: ObjectId.createFromHexString(req.session.username) },
                  { $set: { balance: { USD: newUSD, BTC: newBTC } } }
                );
                await users.updateOne(
                  { _id: ObjectId.createFromHexString(req.session.username) },
                  { $push: { trades: trade } }
                );
                await client.close();
                res.status(200).send("Operation succeded");
              }
            }
          };
          try {
            operate();
          } catch {
            (e) => console.log(e);
          }
        });
      } else {
        res.status(408).send("TimedOut");
      }
    } else {
      res.status(403).send("Forbiden");
    }
  } else {
    res.status(400).send("Wrong-request");
  }
});

app.post("/register", (req, res) => {
  const client = new MongoClient(uri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  client.connect(function (err, db) {
    if (err) throw err;
    const register_user = async () => {
      const dbo = db.db("Bitcoin-fetch");
      const users = dbo.collection("accounts");
      const userDatabase = users.find({ User: req.body.User });
      const alredyRegistered = await userDatabase.toArray();
      if (alredyRegistered.length === 0) {
        console.log(alredyRegistered);
        const user = {
          User: req.body.User,
          Password: req.body.Password,
          balance: { USD: 10000, BTC: 1 },
        };
        dbo.collection("accounts").insertOne(user, function (err, res) {
          if (err) throw err;
          console.log("The new user has been registered In the database");
          client.close();
        });
        res.status(200).send("Registering the new client");
      } else {
        res.status(400).send("User Already registered");
      }
    };

    register_user();
  });
});

/* app.get("/fetch_price", (req, res) => {
  binance.bookTickers((error, ticker) => {
    //console.info("bookTickers()", ticker);
    const ticker_info = ticker.filter((x) => x.symbol == "BTCUSDT")[0];
    const bidPrice = ticker_info.bidPrice;
    console.log(ticker_info);
    console.log(bidPrice);
    res.send(bidPrice);
    //res.send(JSON.stringify(ticker.BNBBTC));
  });
}); */

app.listen(process.env.port || 3000);
console.log("Web Server is listening at port " + (process.env.port || 3000));
