// requirements
const express = require("express");
const cors = require("cors");
require("colors");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");
const { strip } = require("colors");

// variables
const app = express();
const port = process.env.PORT || 5000;

// middle ware
app.use(cors());
app.use(express.json());

const stripe = require("stripe")(process.env.STRIPE_SECRET);

// database connection

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.siwxcfo.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
});

const verifyJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send({ message: "unauthorized access" });
  }

  const token = authHeader.split(" ")[1];
  jwt.verify(token, process.env.ACCESS_TOKEN, function (error, decoded) {
    if (error) {
      return res.status(403).send({ message: "forbidden access" });
    }
    req.decoded = decoded;
    next();
  });
};

async function run() {
  try {
    // appointment options collection
    const appointmentOptionsCollection = client
      .db("doctorsPortal")
      .collection("appointmentOptions");

    // bookings collection
    const bookingsCollection = client
      .db("doctorsPortal")
      .collection("bookings");

    // users collection
    const usersCollection = client.db("doctorsPortal").collection("users");

    // doctors collection
    const doctorsCollection = client.db("doctorsPortal").collection("doctors");

    // payments collection
    const paymentsCollection = client
      .db("doctorsPortal")
      .collection("payments");

    // verifyAdmin middle wear .. ekhane korlam cz ei function aa database er data load kora lagbe
    // r db er data amra try er moddhe rakhsi tai ekhane korlam ..

    const verifyAdmin = async (req, res, next) => {
      const decodedEmail = req.decoded.email;
      const query = { email: decodedEmail };
      const user = await usersCollection.findOne(query);
      if (user.role !== "admin") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    // getting the appointment options
    app.get("/appointmentOptions", async (req, res) => {
      const date = req.query.date;
      const query = {};
      const options = await appointmentOptionsCollection.find(query).toArray();

      const bookingQuery = { appointmentDate: date };
      const alreadyBooked = await bookingsCollection
        .find(bookingQuery)
        .toArray();

      options.forEach((option) => {
        const bookedOptions = alreadyBooked.filter(
          (book) => book.treatment === option.name
        );
        // console.log(bookedOptions);
        const bookedSlots = bookedOptions.map((book) => book.slot);
        // console.log(date, option.name, bookedSlots);

        const remainingSlots = option.slots.filter(
          (slot) => !bookedSlots.includes(slot)
        );

        option.slots = remainingSlots;
      });

      res.send(options);
    });

    // version two of getting the appointment options with mongo aggregation
    app.get("/v2/appointmentOptions", async (req, res) => {
      const date = req.query.date;

      const options = await appointmentOptionsCollection
        .aggregate([
          {
            $lookup: {
              from: "bookings",
              localField: "name",
              foreignField: "treatment",
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $eq: ["$appointmentDate", date],
                    },
                  },
                },
              ],
              as: "booked",
            },
          },
          {
            $project: {
              name: 1,
              price: 1,
              slots: 1,
              booked: {
                $map: {
                  input: "$booked",
                  as: "book",
                  in: "$$book.slot",
                },
              },
            },
          },
          {
            $project: {
              name: 1,
              price: 1,
              slots: {
                $setDifference: ["$slots", "$booked"],
              },
            },
          },
        ])
        .toArray();

      res.send(options);
    });

    // api for appointment specialty
    // eikhane project use kore amra ekta document(object) er moddhe specific kisu field k
    // fetch korte pari
    app.get("/appointmentSpecialty", async (req, res) => {
      const query = {};
      const result = await appointmentOptionsCollection
        .find(query)
        .project({ name: 1 })
        .toArray();
      res.send(result);
    });

    //----------------------------
    //API for bookings ------------
    //------------------------------

    // getting the bookings of a specific user
    app.get("/bookings", verifyJWT, async (req, res) => {
      const email = req.query.email;

      const decodedEmail = req.decoded.email;
      if (decodedEmail !== email) {
        return res.status(403).send({ message: "forbidden access" });
      }

      const query = { email: email };
      const bookings = await bookingsCollection.find(query).toArray();
      res.send(bookings);
    });

    // getting a specific booking
    app.get("/bookings/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: ObjectId(id) };
      const booking = await bookingsCollection.findOne(query);
      res.send(booking);
    });

    // posting a booking to the bookings collection
    app.post("/bookings", async (req, res) => {
      const booking = req.body;

      const query = {
        email: booking.email,
        appointmentDate: booking.appointmentDate,
        treatment: booking.treatment,
      };
      const alreadyBooked = await bookingsCollection.find(query).toArray();

      if (alreadyBooked.length) {
        const message = `You already have an appointment of ${booking.treatment} on ${booking.appointmentDate}`;
        return res.send({ acknowledged: false, message });
      }

      const result = await bookingsCollection.insertOne(booking);
      res.send(result);
    });

    //----------------------------
    //API for users ------------
    //------------------------------

    // getting all the users
    app.get("/users", verifyJWT, verifyAdmin, async (req, res) => {
      const query = {};
      const users = await usersCollection.find(query).toArray();
      res.send(users);
    });

    // adding a new user to the DB
    app.post("/users", async (req, res) => {
      const user = req.body;

      // checking whether the user is already in database
      const email = user.email;
      const query = { email: email };
      const alreadyUser = await usersCollection.findOne(query);
      if (alreadyUser) {
        return res.send({ message: "This email is already in use" });
      }

      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    // verifying whether the user is admin or not
    app.get("/users/admin/:email", verifyJWT, async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      res.send({ isAdmin: user?.role === "admin" });
    });

    // making an user admin
    app.put("/users/admin/:id", verifyJWT, verifyAdmin, async (req, res) => {
      //--
      const id = req.params.id;
      const filter = { _id: ObjectId(id) };
      const options = { upsert: true };
      const updateDoc = {
        $set: {
          role: "admin",
        },
      };
      const result = await usersCollection.updateOne(
        filter,
        updateDoc,
        options
      );
      res.send(result);
    });

    // temporary api for updating a data in appointment options
    // app.get("/addPrice", async (req, res) => {
    //   const filter = {};
    //   const options = { upsert: true };
    //   const updateDoc = {
    //     $set: {
    //       price: 99,
    //     },
    //   };
    //   const result = await appointmentOptionsCollection.updateMany(
    //     filter,
    //     updateDoc,
    //     options
    //   );
    //   res.send(result);
    // });

    //---------------
    // api for doctors
    //-------------------

    // getting the doctors
    app.get("/doctors", verifyJWT, verifyAdmin, async (req, res) => {
      const query = {};
      const doctors = await doctorsCollection.find(query).toArray();
      res.send(doctors);
    });

    // posting a doctor
    app.post("/doctors", verifyJWT, verifyAdmin, async (req, res) => {
      const doctor = req.body;
      const result = await doctorsCollection.insertOne(doctor);
      res.send(result);
    });

    // deleting a doctor
    app.delete("/doctors/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: ObjectId(id) };
      const result = await doctorsCollection.deleteOne(filter);
      res.send(result);
    });

    //----------------------------
    //----------------------------

    // stripe payment api
    app.post("/create-payment-intent", async (req, res) => {
      const booking = req.body;
      const amount = booking.price * 100;

      const paymentIntent = await stripe.paymentIntents.create({
        currency: "usd",
        amount: amount,
        payment_method_types: ["card"],
      });

      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    app.post("/payments", async (req, res) => {
      const payment = req.body;
      const result = await paymentsCollection.insertOne(payment);

      // updating the specific booking after payment
      const id = payment.bookingId;
      const filter = { _id: ObjectId(id) };
      const updateDoc = {
        $set: {
          paid: true,
        },
      };
      const updatedResult = await bookingsCollection.updateOne(
        filter,
        updateDoc
      );

      res.send(result);
    });

    // jwt
    app.get("/jwt", async (req, res) => {
      //ager bar genius car a body er moddhe user send korsilam .. then oikhan theke email  paisilam
      const email = req.query.email;

      const query = { email: email };
      const user = await usersCollection.findOne(query);
      if (user) {
        const token = jwt.sign({ email }, process.env.ACCESS_TOKEN);

        return res.send({ accessToken: token });
      }

      res.status(403).send({ accessToken: "" });
    });
  } finally {
  }
}

run().catch(console.dir);

// root
app.get("/", (req, res) => {
  res.send("Doctors portal server is running");
});

app.listen(port, () => {
  console.log(`Doctors portal server is running in port : ${port}`.bgCyan);
});
