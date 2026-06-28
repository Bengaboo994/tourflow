exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const { priceId, userEmail } = JSON.parse(event.body);

    if (!priceId || !userEmail) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing priceId or userEmail' }),
      };
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer_email: userEmail,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: 'https://tourflow.live/?payment=success',
      cancel_url: 'https://tourflow.live/?payment=cancelled',
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ url: session.url }),
    };
  } catch (err) {
    console.log('Stripe error:', err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
