import { NextRequest, NextResponse } from "next/server";
import { processMessage, createInitialSession, BotSession } from "@/lib/bot";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { message, session, phone } = body as {
    message: string;
    session: BotSession | null;
    phone: string;
  };

  const currentSession = session ?? createInitialSession();
  const result = processMessage(message, currentSession);

  // Persist messages to DB
  try {
    await prisma.message.create({
      data: { phone, content: message, sender: "customer" },
    });
    for (const msg of result.messages) {
      await prisma.message.create({
        data: { phone, content: msg, sender: "bot" },
      });
    }

    // Save completed order
    if (result.session.step === "done" && result.session.cart.length > 0) {
      const subtotal = result.session.cart.reduce((s, i) => s + i.price, 0);
      const order = await prisma.order.create({
        data: {
          phone,
          status: "confirmed",
          deliveryType: result.session.deliveryType ?? "pickup",
          neighborhood: result.session.neighborhood,
          deliveryFee: result.session.deliveryFee,
          paymentMethod: result.session.paymentMethod,
          subtotal,
          total: subtotal + result.session.deliveryFee,
        },
      });
      for (const item of result.session.cart) {
        await prisma.orderItem.create({
          data: {
            orderId: order.id,
            name: `Pizza ${item.size} ${item.flavor}`,
            size: item.size,
            flavor: item.flavor,
            border: item.border,
            price: item.price,
          },
        });
      }
    }
  } catch (e) {
    console.error("DB error:", e);
  }

  return NextResponse.json(result);
}
