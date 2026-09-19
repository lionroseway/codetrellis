# frozen_string_literal: true

require 'json'

module Notifier
  module Channels
    # Sends an email. The fixture never actually sends anything.
    class Email
      attr_reader :address, :last_error

      def self.build(address)
        new(address)
      end

      def initialize(address)
        @address = address
      end

      def deliver(subject, body)
        { to: @address, subject: subject, body: body }.to_json
      end

      private

      def validate
        !@address.nil?
      end
    end
  end
end
