app.post("/retell/tool/commit_booking", requireToolSecret, async (req, res) => {
  try {
    const { email, check_in, check_out, adults, children, board, club_care } = req.body || {};
    
    if (!email || !email.includes("@")) {
      return res.status(400).json({ 
        ok: false, 
        error: "invalid_email" 
      });
    }

    let bookingId = `bk_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;  // Mock Fallback
    
    // Versuche echte HotelRunner Integration
    if (CONFIG.hotelrunner.enabled && CONFIG.hotelrunner.apiKey && CONFIG.hotelrunner.propertyId) {
      try {
        const hrBody = {
          reservation: {
            guest_email: email.toLowerCase().trim(),
            check_in_date: check_in,
            check_out_date: check_out,
            adults: utils.coerceInt(adults, 1),
            children: utils.coerceInt(children, 0),
            board_type: String(board || "frühstück").toLowerCase(),
            extras: club_care ? [{ type: 'club_care', quantity: 1 }] : [],
          }
        };
        
        const hrResponse = await callHotelRunner('reservations', 'POST', hrBody);
        bookingId = hrResponse.reservation_id || bookingId;  // Verwende HR ID
        
        logger.info("HotelRunner booking committed", { bookingId, email: email.toLowerCase().trim(), hrResponse });
      } catch (hrError) {
        logger.warn("HotelRunner booking failed, fallback to mock", hrError);
      }
    }

    const booking = {
      booking_id: bookingId,
      email: email.toLowerCase().trim(),
      check_in,
      check_out,
      adults: utils.coerceInt(adults, 1),
      children: utils.coerceInt(children, 0),
      board: String(board || "frühstück").toLowerCase(),
      club_care: !!club_care,
      created_at: new Date().toISOString(),
      source: CONFIG.hotelrunner.enabled ? "hotelrunner" : "mock"
    };

    logger.info("Booking committed", { bookingId, email: booking.email, source: booking.source });
    return res.json({ ok: true, data: booking });

  } catch (error) {
    logger.error("Booking commit failed", error);
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});